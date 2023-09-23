const express = require('express')
const router = express.Router()
const verify = require('../../middlewares/verify')
const resError = require('../../helpers/resError')
const Promocode = require('../../models/promocode')
const PromocodesLog = require('../../models/promocodeLog')
const Tariff = require('../../models/tariff')

const resSuccess = require('../../helpers/resSuccess')
const getBoolean = require('../../helpers/getBoolean')
const mongoose = require('mongoose')

/*
 * Промокоды
 */

/*
 * Список всех промокодов
 */
router.get('/', verify.token, verify.isAdmin, async (req, res) => {
	const skip = +req.query.skip || 0
	const limit = +(req.query.limit > 0 && req.query.limit <= 20 ? req.query.limit : 20)

	const isActive = getBoolean(req.query.isActive)

	const match = {
		$match: {
			$and: [
				{ startAt: { $lte: new Date() } },
				{ finishAt: { $gte: new Date() } },
				{ deleted: { $ne: true } },
			],
		},
	}

	try {
		Promocode.aggregate(
			[
				{
					$facet: {
						totalSize: [
							...(isActive ? [match] : []),
							{
								$group: {
									_id: null,
									count: { $sum: 1 },
								},
							},
							{ $project: { _id: false } },
							{ $limit: 1 },
						],
						items: [
							...(isActive ? [match] : []),
							{ $sort: { createdAt: -1 } },
							{
								$project: {
									updatedAt: false,
									__v: false,
								},
							},
							{ $skip: skip },
							{ $limit: limit },
						],
					},
				},
				{ $unwind: { path: '$totalSize', preserveNullAndEmptyArrays: true } },
				{
					$project: {
						totalSize: { $cond: ['$totalSize.count', '$totalSize.count', 0] },
						items: '$items',
					},
				},
			],
			async (err, result) => {
				return res.status(200).json(result[0])
			}
		)
	} catch (err) {
		return resError({ res, msg: err })
	}
})

/*
 * Создать промокод
 */

router.post('/', verify.token, verify.isAdmin, async (req, res) => {
	const {
		value,
		startAt,
		finishAt,
		maxAmountActivation,
		tariffName,
		discountFormat,
		sizeDiscount,
		isActive = false,
		isOnlyForNewUsers = true,
	} = req.body

	if (!maxAmountActivation) return resError({ res, msg: 'Не передан maxAmountActivation' })
	if (!discountFormat) return resError({ res, msg: 'Не передан discountFormat' })
	if (discountFormat !== 'free-month' && !sizeDiscount)
		return resError({ res, msg: 'Не передан sizeDiscount' })
	if (discountFormat !== 'free-month' && !tariffName)
		return resError({ res, msg: 'Не передан tariffName' })
	if (!value) return resError({ res, msg: 'Не передан value' })

	if (!startAt)
		return resError({
			res,
			msg: 'Не передана дата и время начала действия промокода - параметр startAt',
		})
	if (!finishAt)
		return resError({
			res,
			msg: 'Не передана дата и время начала действия промокода - параметр finishAt',
		})

	const existTariff = Tariff.findOne({ name: tariffName })
	if (!existTariff) return resError({ res, msg: 'Указанного тарифа не существует' })

	const existPromocode = await Promocode.findOne({ value })
	if (existPromocode) return resError({ res, msg: 'Промокод с таким названием уже существует' })

	try {
		const response = await Promocode.create({
			value,
			maxAmountActivation,
			discountFormat,
			sizeDiscount,
			tariffName,
			isOnlyForNewUsers,
			isActive,
			startAt: new Date(startAt),
			finishAt: new Date(finishAt),
			currentAmountActivation: 0,
		})

		return res.status(200).json({
			success: true,
			msg: 'Промокод успешно создан',
		})
	} catch (err) {
		return resError({ res, msg: err })
	}
})

/*
 * Изменить промокод
 */
router.patch('/', verify.token, verify.isAdmin, async (req, res) => {
	const { _id, title, value, type, startAt, finishAt } = req.body

	try {
		const promocode = await Promocode.findOne({ _id })

		if (!promocode) {
			return resError({ res, msg: 'Промокода с указанным _id не найдено' })
		}

		if (title) promocode.title = title
		if (value) promocode.value = value
		if (type) promocode.type = type
		if (startAt) promocode.startAt = new Date(startAt)
		if (finishAt) promocode.finishAt = new Date(finishAt)

		promocode.save()

		return resSuccess({
			res,
			alert: true,
			msg: 'Промокод обновлен',
		})
	} catch (err) {
		return resError({ res, msg: err })
	}
})

/*
 * Удалить промокод
 */
router.delete('/', verify.token, verify.isAdmin, async (req, res) => {
	const { _id } = req.body

	if (!_id) return resError({ res, msg: 'Не передан _id' })

	try {
		const promocode = await Promocode.findOne({ _id })

		if (!promocode) {
			return resError({ res, msg: 'Промокода с указанным _id не найдено' })
		}

		promocode.deleted = true
		promocode.save()

		return resSuccess({
			res,
			_id,
			alert: true,
			msg: 'Успешно удалено',
		})
	} catch (err) {
		return resError({ res, msg: err })
	}
})

/*
 *  Количество активаций у одного промокода
 */
router.get('/count', verify.token, verify.isAdmin, async (req, res) => {
	const { _id } = req.query

	if (!_id) return resError({ res, msg: 'Не передан _id' })

	try {
		const result = await PromocodesLog.aggregate([
			{
				$facet: {
					totalSize: [
						{
							$match: {
								promocodeId: mongoose.Types.ObjectId(_id),
							},
						},
						{
							$group: {
								_id: null,
								count: { $sum: 1 },
							},
						},
						{ $limit: 1 },
					],
				},
			},
			{ $limit: 1 },
			{ $unwind: { path: '$totalSize', preserveNullAndEmptyArrays: true } },
			{
				$project: {
					totalSize: { $cond: ['$totalSize.count', '$totalSize.count', 0] },
					id: _id,
				},
			},
		])

		return res.status(200).json(result[0])
	} catch (err) {
		return resError({ res, msg: err })
	}
})

/*
 *  Количество активаций у всех промокодов
 */
router.get('/countAll', verify.token, verify.isAdmin, async (req, res) => {
	const skip = +req.query.skip || 0
	const limit = +(req.query.limit > 0 && req.query.limit <= 20 ? req.query.limit : 20)

	try {
		const activatedPromocodesAmount = await PromocodesLog.countDocuments({}) // Общее количество активированных когда либо промокодов

		Promocode.aggregate(
			[
				{
					$facet: {
						totalSize: [
							{
								$group: {
									_id: null,
									count: { $sum: 1 },
								},
							},
							{ $project: { _id: false } },
							{ $limit: 1 },
						],
						totalSizeActiveNow: [
							{
								$match: {
									isActive: true,
									startAt: { $lte: new Date() },
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
						totalSizeNotPublishedNow: [
							{
								$match: {
									isActive: false,
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
						items: [
							{ $sort: { updatedAt: -1 } },
							{
								$project: {
									updatedAt: true,
									value: true,
									startAt: true,
									finishAt: true,
									isActive: true,
									maxAmountActivation: true,
									currentAmountActivation: true,
								},
							},
							{ $skip: skip },
							{ $limit: limit },
						],
					},
				},
				{ $limit: 1 },
				{ $unwind: { path: '$totalSize', preserveNullAndEmptyArrays: true } },
				{ $unwind: { path: '$totalSizeActiveNow', preserveNullAndEmptyArrays: true } },
				{ $unwind: { path: '$totalSizeNotPublishedNow', preserveNullAndEmptyArrays: true } },
				{
					$project: {
						totalSize: { $cond: ['$totalSize.count', '$totalSize.count', 0] },
						totalSizeActiveNow: {
							$cond: ['$totalSizeActiveNow.count', '$totalSizeActiveNow.count', 0],
						},
						totalSizeNotPublishedNow: {
							$cond: ['$totalSizeNotPublishedNow.count', '$totalSizeNotPublishedNow.count', 0],
						},
						items: '$items',
					},
				},
			],
			async (err, result) => {
				const finalResult = { activatedPromocodesAmount, ...result[0] }
				return res.status(200).json(finalResult)
			}
		)
	} catch (err) {
		return resError({ res, msg: err })
	}
})

module.exports = router
