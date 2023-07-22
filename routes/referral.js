const express = require('express');
const router = express.Router();
const User = require('../models/user');
const Tariff = require('../models/tariff');
const verify = require('../middlewares/verify');
const resError = require('../helpers/resError');
const resSuccess = require('../helpers/resSuccess');
const formatDate = require('../helpers/formatDate');
const { DOMAIN, REFERRAL_PRECENT_BONUSE } = process.env;
const ReferralWithdrawalLog = require('../models/referralWithdrawalLog');

/*
 * Реферальная программа
 */


/*
 * Получение общих данных
 */
router.get('/', verify.token, async (req, res) => {
	const link = `${DOMAIN}/?r=${req.user._id}` // Реферальная ссылка
	const referralPercentBonuse = +REFERRAL_PRECENT_BONUSE // Бонус в процентах от реферала 
	const balance = req.user.referral.balance // Текущий баланс с подписок рефералов
	const card = req.user.referral.card // Данные карты для вывода баланса

	return res.status(200).json({
		link,
		referralPercentBonuse,
		balance,
		card
	});
})


/*
 * Список "Мои рефералы"
 */
router.get('/invitedReferrals', verify.token, async (req, res) => {
	const skip = +req.query.skip || 0
	const limit = +(req.query.limit > 0 && req.query.limit <= 100 ? req.query.limit : 100);

	const searchMatch = {
		_id: {
			$in: req.user.referral.userIds
		}
	};

	try {
		const result = await User.aggregate([
			{ "$facet": {
				// Всего записей
				"totalSize": [
					{ $match: searchMatch },
					{ $lookup: {
						from: "paymentlogs",
						localField: "_id",
						foreignField: "userId",
						pipeline: [
							{ $match: {
								type: 'paid',
								status: 'success'
							} },
							{ $project: {
								_id: false
							} },
							{ $sort: { _id: 1 } },
							{ $limit: 1 }
						],
						as: "payment"
					} },
					{ $unwind: { path: "$payment", preserveNullAndEmptyArrays: true } },
					{ $group: { 
						_id: null, 
						count: { $sum: 1 }
					} },
					{ $project: { _id: false } },
					{ $limit: 1 }
				],
				// Список
				"items": [
					{ $match: searchMatch },
					{ $lookup: {
						from: "paymentlogs",
						localField: "_id",
						foreignField: "userId",
						pipeline: [
							{ $match: {
								type: 'paid',
								status: 'success'
							} },
							{ $project: {
								_id: false,
								status: true,
								createdAt: true,
								bonuseAmount: {
									$multiply: [ "$withdrawAmount", +REFERRAL_PRECENT_BONUSE / 100 ],
								},
							} },
							{ $sort: { _id: 1 } },
							{ $limit: 1 }
						],
						as: "payment"
					} },
					{ $unwind: { path: "$payment", preserveNullAndEmptyArrays: true } },
					{ $lookup: {
						from: "tariffs",
						localField: "tariffId",
						foreignField: "payment.tariffId",
						pipeline: [
							{ $project: {
								_id: false,
								name: true
							} },
							{ $limit: 1 }
						],
						as: "tariff"
					} },
					{ $unwind: { path: "$tariff" } },
					{ $project: {
						_id: false,
						user: {
							avatar: "$avatar",
							firstname: "$firstname",
						},
						payment: {
							$cond: [
								{ $eq: [ "$payment.status" , "success" ] },
								{ $mergeObjects: [ 
									"$payment", 
									{ tariffName: "$tariff.name" }
								] },
								null
							]
						},
					} },
					{ $sort: { _id: -1 } },
					{ $skip: skip },
					{ $limit: limit },
				]
				
			} },
			{ $limit: 1 },
			{ $unwind: { path: "$totalSize", preserveNullAndEmptyArrays: true } },
			{ $project: {
				totalSize: { $cond: [ "$totalSize.count", "$totalSize.count", 0] },
				items: "$items"
			} },
		]);

		const response = {}

		result[0].items.forEach(referalItem=>{
			const date = formatDate(referalItem.payment.createdAt)

			if (date in response){
				response[date].items.push(referalItem)
				const bonuseAmountCurrentItem =  Number(referalItem.payment.bonuseAmount) || 0
				response[date].totalBonus += bonuseAmountCurrentItem
			} else {
				response[date] = {}
				response[date].items = [referalItem]
				response[date].totalBonus = Number(referalItem.payment.bonuseAmount)||0
			}
		})
		return res.status(200).json(response);

	} catch(err) {
		return resError({ res, msg: err });
	}
})


/*
 * Список "История выводов"
 */
router.get('/withdrawalOfMoney', verify.token, async (req, res) => {
	const skip = +req.query.skip || 0
	const limit = +(req.query.limit > 0 && req.query.limit <= 100 ? req.query.limit : 100);

	try {
		const result = await ReferralWithdrawalLog.aggregate([
			{ "$facet": {
				// Всего записей
				"totalSize": [
					{ $match: {
						userId: req.user._id
					} },
					{ $group: { 
						_id: null, 
						count: { $sum: 1 }
					} },
					{ $project: { _id: false } },
					{ $limit: 1 }
				],
				// Список
				"items": [
					{ $match: {
						userId: req.user._id
					} },
					{ $project: {
						_id: false,
						amount: true,
						card: {
							number: { 
								$concat : [
									"**** **** **** ",
									{ $substrBytes: [ "$card.number", 12, 16 ] }
								]
							}
						},
						status: true
					} },
					{ $sort: { _id: -1 } },
					{ $skip: skip },
					{ $limit: limit },
				]
				
			} },
			{ $limit: 1 },
			{ $unwind: { path: "$totalSize", preserveNullAndEmptyArrays: true } },
			{ $project: {
				totalSize: { $cond: [ "$totalSize.count", "$totalSize.count", 0] },
				items: "$items"
			} },
		]);

		return res.status(200).json(result[0]);
	} catch(err) {
		return resError({ res, msg: err });
	}
})


/*
 * Изменить данные карты
 */
router.patch('/changeCard', verify.token, async (req, res) => {

	let { number, cardholder } = req.body;

	if(!number || !cardholder) {
		return resError({
			res, 
			alert: true,
			msg: 'Недостаточно данных'
		});
	}

	number = number.toString();
	cardholder = cardholder.toString();

	if(number.length !== 16) {
		return resError({
			res, 
			alert: true,
			msg: 'Недопустимая длина поля: Номер карты'
		});
	}

	if(cardholder.length > 150) {
		return resError({
			res, 
			alert: true,
			msg: 'Превышена длина поля: ФИО'
		});
	}

	try {
		await User.updateOne(
			{ _id: req.user._id }, 
			{ $set: { 
				"referral.card": {
					number,
					cardholder
				}
			} }
		)

		return resSuccess({
			res,
			alert: true,
			msg: 'Карта обновлена'
		})
	} catch(err) {
		return resError({ res, msg: err });
	}
})


/*
 * Создание заявки на вывод c обнулением баланса
 */
router.post('/withdrawBalance', verify.token, async (req, res) => {
	const { card, balance } = req.user.referral

	if(!card || card.number.length !== 16) {
		return resError({
			res, 
			alert: true,
			msg: 'Требуется добавить карту'
		});
	}

	if(!balance || +balance <= 0) {
		return resError({
			res, 
			alert: true,
			msg: 'Недостаточно средств для вывода'
		});
	}
	
	try {
		await new ReferralWithdrawalLog({
			userId: req.user._id,
			amount: +balance,
			card: req.user.referral.card,
			status: 'pending'
		}).save();


		await User.updateOne(
			{ _id: req.user._id }, 
			{ $set: { 
				"referral.balance": 0
			} }
		)

		return resSuccess({
			res,
			alert: true,
			msg: 'Создана заявка на вывод средств'
		})
	} catch(err) {
		return resError({ res, msg: err });
	}
})

module.exports = router;