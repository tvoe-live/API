const express = require('express');
const router = express.Router();
const mongoose = require('mongoose');
const User = require('../../models/user');
const Tariff = require('../../models/tariff');
const verify = require('../../middlewares/verify');
const resError = require('../../helpers/resError');
const PaymentLog = require('../../models/paymentLog');
const resSuccess = require('../../helpers/resSuccess');
const getSearchQuery = require('../../middlewares/getSearchQuery');

/*
 * Админ-панель > Пользователи
 */

// Получение списка пользователей
router.get('/', verify.token, verify.isAdmin, getSearchQuery, async (req, res) => {
	const cursorId = mongoose.Types.ObjectId(req.query.cursorId);
	const limit = +(req.query.limit > 0 && req.query.limit <= 100 ? req.query.limit : 100);

	const cursorMatch = req.query.cursorId ? { 
		_id: { $lt: cursorId } 
	} : null;
	
	const searchMatch = req.RegExpQuery && {
		$or: [
			{ _id: req.RegExpQuery },
			{ email: req.RegExpQuery },
			{ firstname: req.RegExpQuery }
		]
	};

	try {
		const result = await User.aggregate([
			{ "$facet": {
				// Всего записей
				"totalSize": [
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
						...searchMatch,
						...cursorMatch,
					} },
					{ $project: {
						role: true,
						email: true,
						avatar: true,
						firstname: true,
						updatedAt: true,
						createdAt: true,
						subscribe: true,
						lastVisitAt: true,
					} },
					{ $sort : { _id: -1 } },
					{ $limit: limit }
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
});

// Получение пользователя
router.get('/profile', verify.token, verify.isAdmin, async (req, res) => {

	try {
		const { id } = req.query;
		const userId = mongoose.Types.ObjectId(id);
	
		if(!id) return resError({ res, msg: 'Не получен ID' });

		let tariffs = await Tariff.aggregate([
			{ $project: {
				duration: false
			} },
			{ $sort: {
				sort: 1
			} },
			{ $limit: 5 }
		]);

		const user = await User.findOne(
			{ _id: userId },
			{
				role: true,
				email: true,
				avatar: true,
				deleted: true,
				firstname: true,
				subscribe: true,
			}
		);

		return res.status(200).json({
			user,
			tariffs
		});

	} catch(err) {
		return resError({ res, msg: err });
	}
});

router.patch('/profile', verify.token, verify.isAdmin, async (req, res) => {

	try {
		const { 
			_id,
			role,
			tariffId
		} = req.body;
		const userId = mongoose.Types.ObjectId(_id);

		const user = await User.findOne(
			{ _id: userId },
			{
				role: true,
				email: true,
				avatar: true,
				deleted: true,
				firstname: true,
				subscribe: true,
			}
		);

		if(tariffId === 'null') {
			await User.updateOne(
				{ _id: userId }, 
				{ $unset: { subscribe: null } }
			);
		}

		if(tariffId && tariffId !== 'null' && (!user.subscribe || tariffId !== user.subscribe.tariffId)) {
			const tariffs = await Tariff.find({}, {
				_id: true,
				price: true,
				duration: true
			});
			const selectedTariff = tariffs.find(tariff => tariff._id.toString() === tariffId);

			if(!selectedTariff) {
				return resError({
					res,
					alert: true,
					msg: 'Тарифа не существует'
				});
			}
		

			if(!user.subscribe || (user.subscribe && tariffId != user.subscribe.tariffId)) {
				const tariffDuration = Number(selectedTariff.duration);
				const startAt = new Date();
				const finishAt = new Date(startAt.getTime() + tariffDuration);

				const paymentLog = await new PaymentLog({
					startAt,
					finishAt,
					userId: userId,
					type: 'issued-by-admin',
					tariffId: selectedTariff._id,
				}).save();

				// Обновить время подписки пользователю и 
				// запретить использовать беспользовать бесплатный тариф
				await User.updateOne(
					{ _id: userId }, 
					{ $set: {
						subscribe: {
							startAt,
							finishAt,
							tariffId: paymentLog.tariffId
						},
						allowTrialTariff: false
					} }
				);
			}
		}
	

		await User.updateOne(
			{ _id: userId }, 
			{
				$set: { role },
				$inc: { '__v': 1 }
			}
		);

		return resSuccess({ 
			res, 
			msg: 'Профиль обновлен'
		})

	} catch(err) {
		return resError({ res, msg: err });
	}
});

module.exports = router;