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
	const tariffFilterParam = req.query.tariffId && {
		tariffId: mongoose.Types.ObjectId(`${req.query.tariffId}`),
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

	try {
		let tariffsStats = await Tariff.aggregate([
			// Действующие подписок
			{
				$lookup: {
					from: 'paymentlogs',
					localField: '_id',
					foreignField: 'tariffId',
					pipeline: [
						{
							$match: {
								finishAt: { $gte: new Date() },
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
					as: 'activeSubscriptions',
				},
			},
			// Активаций подписок
			{
				$lookup: {
					from: 'paymentlogs',
					localField: '_id',
					foreignField: 'tariffId',
					pipeline: [
						{
							$match: {
								finishAt: { $ne: null },
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
					as: 'activationsSubscriptions',
				},
			},
			// Сумма всех пополнений
			{
				$lookup: {
					from: 'paymentlogs',
					localField: '_id',
					foreignField: 'tariffId',
					pipeline: [
						{
							$match: {
								$or: [{ status: 'success' }, { status: 'CONFIRMED' }, { status: 'AUTHORIZED' }],
							},
						},
						{
							$group: {
								_id: null,
								count: {
									$sum: {
										$cond: ['$withdrawAmount' > 0, '$withdrawAmount', '$amount'],
									},
								},
							},
						},
						{ $project: { _id: false } },
						{ $limit: 1 },
					],
					as: 'totalAmount',
				},
			},
			{ $unwind: { path: '$totalAmount', preserveNullAndEmptyArrays: true } },
			{ $unwind: { path: '$activeSubscriptions', preserveNullAndEmptyArrays: true } },
			{ $unwind: { path: '$activationsSubscriptions', preserveNullAndEmptyArrays: true } },
			{
				$project: {
					name: true,
					duration: true,
					totalAmount: { $cond: ['$totalAmount.count', '$totalAmount.count', 0] },
					activeSubscriptions: {
						$cond: ['$activeSubscriptions.count', '$activeSubscriptions.count', 0],
					},
					activationsSubscriptions: {
						$cond: ['$activationsSubscriptions.count', '$activationsSubscriptions.count', 0],
					},
				},
			},
			{ $sort: { duration: 1 } },
			{ $limit: 5 },
		])

		const result = await PaymentLog.aggregate([
			{
				$facet: {
					// Всего записей
					totalSize: [
						{
							$match: {
								$or: [{ status: 'success' }, { status: 'CONFIRMED' }, { status: 'AUTHORIZED' }],
								...dateFilterParam,
								...tariffFilterParam,
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
								$or: [{ status: 'success' }, { status: 'CONFIRMED' }, { status: 'AUTHORIZED' }],
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
										$project: {
											role: true,
											email: true,
											avatar: true,
											subscribe: true,
											firstname: true,
										},
									},
								],
								as: 'user',
							},
						},
						{ $unwind: { path: '$user' } },
						{
							$project: {
								user: true,
								tariff: true,
								startAt: true,
								finishAt: true,
								updatedAt: true,
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
			{ $unwind: { path: '$totalAmount', preserveNullAndEmptyArrays: true } },
			{ $unwind: { path: '$totalSize', preserveNullAndEmptyArrays: true } },
			{
				$project: {
					totalAmount: { $cond: ['$totalAmount.count', '$totalAmount.count', 0] },
					totalSize: { $cond: ['$totalSize.count', '$totalSize.count', 0] },
					items: '$items',
				},
			},
		])

		return res.status(200).json({
			tariffsStats,
			...result[0],
		})
	} catch (err) {
		return resError({ res, msg: err })
	}
})

module.exports = router
