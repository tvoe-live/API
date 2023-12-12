const express = require('express')
const router = express.Router()
const mongoose = require('mongoose')
const User = require('../../models/user')
const Tariff = require('../../models/tariff')
const verify = require('../../middlewares/verify')
const resError = require('../../helpers/resError')
const PaymentLog = require('../../models/paymentLog')
const resSuccess = require('../../helpers/resSuccess')

/*
 * Профиль > Подписка
 */

router.get('/', verify.token, async (req, res) => {
	const cursorId = mongoose.Types.ObjectId(req.query.cursorId)
	const limit = +(req.query.limit > 0 && req.query.limit <= 100 ? req.query.limit : 100)

	const cursorMatch = req.query.cursorId
		? {
				_id: { $lt: cursorId },
		  }
		: null

	const searchMatch = {
		userId: req.user._id,
		startAt: { $ne: null },
		finishAt: { $ne: null },
		$or: [
			{
				type: {
					$in: ['issued-by-admin', 'trial', 'paid'],
				},
			},
			{
				status: {
					$in: ['success', 'CONFIRMED', 'AUTHORIZED', 'PARTIAL_REFUNDED', 'REFUNDED'],
				},
			},
		],
	}

	try {
		let tariffs = await Tariff.aggregate([
			{
				$match: {
					hidden: { $in: [false, null] },
				},
			},
			{
				$project: {
					duration: false,
				},
			},
			{
				$sort: {
					sort: 1,
				},
			},
			{ $limit: 6 },
		])

		const result = await PaymentLog.aggregate([
			{
				$facet: {
					tariffs: [
						{
							$lookup: {
								from: 'tariffs',
								pipeline: [],
								as: 'tariffs',
							},
						},
						{ $unwind: '$tariffs' },
						{
							$project: {
								tariffs: true,
							},
						},
						{ $limit: 6 },
					],
					// Всего записей
					totalSize: [
						{
							$match: {
								...searchMatch,
							},
						},
						{
							$group: {
								_id: null,
								count: { $sum: 1 },
							},
						},
						{ $project: { _id: false } },
						{ $limit: 1 },
					],
					// Список
					items: [
						{
							$match: {
								...searchMatch,
								...cursorMatch,
							},
						},
						{
							$lookup: {
								from: 'tariffs',
								localField: 'tariffId',
								foreignField: '_id',
								as: 'tariff',
							},
						},
						{ $unwind: '$tariff' },
						{
							$project: {
								type: true,
								status: true,
								startAt: true,
								finishAt: true,
								tariffPrice: true,
								promocodeId: true,
								refundedAmount: true,
								notificationType: true,
								tariffPrice: true,
								tariff: {
									_id: true,
									name: true,
								},
								amount: {
									$cond: ['$withdrawAmount', '$withdrawAmount', '$amount'],
								},
							},
						},
						{ $sort: { _id: -1 } },
						{ $limit: limit },
					],
				},
			},
			{ $limit: 1 },
			{ $unwind: { path: '$totalSize', preserveNullAndEmptyArrays: true } },
			{
				$project: {
					last: '$last',
					totalSize: { $cond: ['$totalSize.count', '$totalSize.count', 0] },
					items: '$items',
				},
			},
		])

		// Данные о текущей подписки
		const currentSubscribe = {
			tariffId: null,
			tariffPrice: null,
			...req.user.subscribe,
		}

		currentSubscribe.tariffPrice = tariffs.find(
			(tariff) => tariff._id.toString() === req.user.subscribe.tariffId.toString()
		)?.price

		// Если тариф за 1р, то показать цену следующего списания за 1 месяц
		if (currentSubscribe.tariffPrice === 1) {
			monthTariff = tariffs.find((tariff) => tariff.autoEnableAfterTrialTariff)

			currentSubscribe.tariffId = monthTariff._id
			currentSubscribe.tariffPrice = monthTariff.price
		}

		return res.status(200).json({
			currentSubscribe,
			tariffs,
			...result[0],
		})
	} catch (err) {
		return resError({ res, msg: err })
	}
})

router.patch('/change-autopayment', verify.token, async (req, res) => {
	try {
		const findedUser = await User.findById(req.user._id)

		findedUser.autoPayment = !findedUser.autoPayment

		await findedUser.save()

		if (findedUser.autoPayment === true) {
			return resSuccess({
				res,
				alert: true,
				msg: 'Автопродление подписки включено',
				autoPayment: true,
			})
		}

		return resSuccess({
			res,
			alert: true,
			msg: 'Автопродление подписки отключено',
			autoPayment: false,
		})
	} catch (err) {
		return resError({ res, msg: err })
	}
})

module.exports = router
