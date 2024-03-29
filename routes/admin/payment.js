const express = require('express')
const router = express.Router()
const mongoose = require('mongoose')
const Tariff = require('../../models/tariff')
const verify = require('../../middlewares/verify')
const resError = require('../../helpers/resError')
const PaymentLog = require('../../models/paymentLog')
const getSearchQuery = require('../../middlewares/getSearchQuery')
const isValidObjectId = require('../../helpers/isValidObjectId')

/*
 * Админ-панель > История пополнений
 */

// Получение списка пользователей
router.get('/', verify.token, verify.isAdmin, getSearchQuery, async (req, res) => {
	const skip = +req.query.skip || 0
	const limit = +(req.query.limit > 0 && req.query.limit <= 100 ? req.query.limit : 100)

	const dateFilterParam = req.query.start && {
		$and: [
			{ createdAt: { $gte: new Date(req.query.start) } },
			{ createdAt: { $lt: new Date(req.query.end ? req.query.end : new Date()) } },
		],
	}

	let tariffFilterParam

	if (req.query.tariffName) {
		const { _id: tariffId } = await Tariff.findOne({ name: req.query.tariffName })
		tariffFilterParam = {
			tariffId: mongoose.Types.ObjectId(tariffId),
		}
	}

	const searchMatch = req.RegExpQuery && {
		$or: [
			...(isValidObjectId(req.searchQuery)
				? [{ _id: mongoose.Types.ObjectId(req.searchQuery) }]
				: []),
			{ email: req.RegExpQuery },
			{ firstname: req.RegExpQuery },
		],
	}

	const mainAgregation = [
		{
			$match: {
				type: 'paid',
				status: { $in: ['success', 'CONFIRMED', 'AUTHORIZED'] },
				...dateFilterParam,
				...tariffFilterParam,
			},
		},
		{
			$lookup: {
				from: 'tariffs',
				localField: 'tariffId',
				foreignField: '_id',
				pipeline: [
					{
						$project: {
							_id: false,
							name: true,
						},
					},
				],
				as: 'tariff',
			},
		},
		{ $unwind: { path: '$tariff' } },
		{
			$lookup: {
				from: 'users',
				localField: 'userId',
				foreignField: '_id',
				pipeline: [
					{
						$match: {
							...searchMatch,
						},
					},
					{
						$addFields: {
							isBanned: {
								$cond: {
									if: {
										$and: [
											{ $ne: ['$banned', null] },

											{
												$or: [
													{ $eq: ['$banned.finishAt', null] },
													{ $gt: ['$banned.finishAt', new Date()] },
												],
											},
										],
									},
									then: true,
									else: false,
								},
							},
						},
					},
					{
						$project: {
							role: true,
							phone: '$authPhone',
							avatar: true,
							subscribe: true,
							firstname: true,
							isBanned: true,
						},
					},
				],
				as: 'user',
			},
		},
		{ $unwind: { path: '$user' } },
	]

	try {
		const result = await PaymentLog.aggregate([
			{
				$facet: {
					// Всего записей
					totalSize: [
						...mainAgregation,
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
						...mainAgregation,
						{
							$project: {
								type: true,
								user: true,
								tariff: true,
								status: true,
								startAt: true,
								finishAt: true,
								updatedAt: true,
								isReccurent: true,
								tariffPrice: true,
								promocodeId: true,
								refundedAmount: true,
								amount: {
									$cond: ['$withdrawAmount', '$withdrawAmount', '$amount'],
								},
							},
						},
						{ $sort: { _id: -1 } }, // Была сортировка updatedAt
						{ $skip: skip },
						{ $limit: limit },
					],
				},
			},
			{ $limit: 1 },
			{ $unwind: { path: '$totalSize', preserveNullAndEmptyArrays: true } },
			{
				$project: {
					totalSize: { $cond: ['$totalSize.count', '$totalSize.count', 0] },
					items: '$items',
				},
			},
		])

		return res.status(200).json(result[0])
	} catch (err) {
		return resError({ res, msg: err })
	}
})

module.exports = router
