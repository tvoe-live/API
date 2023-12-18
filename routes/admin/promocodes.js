const express = require('express')
const mongoose = require('mongoose')

const User = require('../../models/user')
const Tariff = require('../../models/tariff')
const Promocode = require('../../models/promocode')
const PromocodesLog = require('../../models/promocodeLog')

const verify = require('../../middlewares/verify')
const getSearchQuery = require('../../middlewares/getSearchQuery')

const resError = require('../../helpers/resError')
const resSuccess = require('../../helpers/resSuccess')
const getBoolean = require('../../helpers/getBoolean')
const isValidObjectId = require('../../helpers/isValidObjectId')

const router = express.Router()

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
				{ deleted: { $ne: true } },
				{
					$or: [
						{ finishAt: { $gte: new Date() } },
						{ finishAt: { $exists: false } },
						{ finishAt: null },
					],
				},
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
		tariffName,
		discountFormat,
		sizeDiscount,
		startAt,
		finishAt = null,
		maxAmountActivation = null,
		isActive = false,
		isOnlyForNewUsers = true,
	} = req.body

	if (!discountFormat) return resError({ res, msg: 'Не передан discountFormat', alert: true })
	if (discountFormat !== 'free' && !sizeDiscount)
		return resError({ res, msg: 'Не передан sizeDiscount', alert: true })
	if (!tariffName) return resError({ res, msg: 'Не передан tariffName', alert: true })
	if (!value) return resError({ res, msg: 'Не передан value', alert: true })
	if (value.length > 32)
		return resError({ res, msg: 'Длина промокода не может превышать 32 символа', alert: true })

	if (!startAt)
		return resError({
			res,
			msg: 'Не передана дата и время начала действия промокода - параметр startAt',
			alert: true,
		})

	if (tariffName !== 'universal') {
		const existTariff = await Tariff.findOne({ name: tariffName })
		if (!existTariff) return resError({ res, msg: 'Указанного тарифа не существует', alert: true })

		if (discountFormat === 'rubles' && (sizeDiscount < 1 || sizeDiscount > existTariff.price - 1)) {
			return resError({ res, msg: 'Не допустимая величина скидки', alert: true })
		}
	} else {
		const allTariffs = await Tariff.find()

		// Находим цену самого дорого тарифа
		const maxPrice = allTariffs.reduce((accum, currentEl) => {
			if (currentEl.price > accum) accum = currentEl.price
			return accum
		}, allTariffs[0]?.price)

		if (discountFormat === 'rubles' && (sizeDiscount < 1 || sizeDiscount > maxPrice - 1)) {
			return resError({ res, msg: 'Не допустимая величина скидки', alert: true })
		}
	}

	if (discountFormat === 'percentages' && (sizeDiscount < 1 || sizeDiscount > 99)) {
		return resError({ res, msg: 'Не допустимый процент скидки', alert: true })
	}

	const existPromocode = await Promocode.findOne({ value, deleted: { $ne: true } })
	if (existPromocode)
		return resError({ res, msg: 'Промокод с таким названием уже существует', alert: true })

	try {
		await Promocode.create({
			value,
			maxAmountActivation,
			discountFormat,
			sizeDiscount,
			tariffName,
			isOnlyForNewUsers,
			isActive,
			startAt: new Date(startAt),
			finishAt: finishAt ? new Date(finishAt) : null,
			currentAmountActivation: 0,
		})

		return res.status(200).json({
			success: true,
			alert: true,
			msg: 'Промокод успешно создан',
		})
	} catch (err) {
		return resError({ res, msg: err })
	}
})

/*
 * Изменить промокод
 */
router.patch('/:id', verify.token, verify.isAdmin, async (req, res) => {
	const {
		value,
		startAt,
		finishAt,
		maxAmountActivation,
		tariffName,
		discountFormat,
		sizeDiscount,
		isActive,
		isOnlyForNewUsers,
	} = req.body

	try {
		const promocode = await Promocode.findOne({ _id: req.params.id })

		if (!promocode) {
			return resError({ res, msg: 'Промокода с указанным _id не найдено' })
		}

		if (value) promocode.value = value
		if (startAt) promocode.startAt = new Date(startAt)
		if ('finishAt' in req.body) promocode.finishAt = finishAt ? new Date(finishAt) : finishAt
		if (maxAmountActivation) promocode.maxAmountActivation = maxAmountActivation
		if (tariffName) promocode.tariffName = tariffName
		if (discountFormat) promocode.discountFormat = discountFormat
		if (sizeDiscount) promocode.sizeDiscount = sizeDiscount
		if ('isActive' in req.body) promocode.isActive = isActive
		if ('isOnlyForNewUsers' in req.body) promocode.isOnlyForNewUsers = isOnlyForNewUsers

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
 *  Отменить действие промокода для конкретного юзера
 */
router.delete('/cancel/:id', verify.token, verify.isAdmin, async (req, res) => {
	const _id = req.params?.id
	if (!_id) return resError({ res, msg: 'Не передан id' })

	try {
		const promocodeLog = await PromocodesLog.findOne({
			_id,
		})

		if (!promocodeLog) {
			return resError({
				res,
				msg: `Невозможно отменить действие промокода, так как promocodeLog c id = ${_id} не существует`,
			})
		}

		if (promocodeLog.isCancelled) {
			return resError({ res, msg: 'Промокод уже был отменен ранее' })
		} else if (promocodeLog.isPurchaseCompleted) {
			const user = await User.findOne({ _id: promocodeLog.userId })
			const promocode = await Promocode.findOne({ _id: promocodeLog.promocodeId })

			const tariff = await Tariff.findOne({ name: promocode.tariffName })

			if (Date.now() < promocodeLog.createdAt.getTime() + Number(tariff.duration)) {
				user.subscribe = null
				user.save()
			}
		}

		promocodeLog.isCancelled = true
		promocodeLog.save()

		return resSuccess({
			res,
			alert: true,
			msg: 'Действие промокода отменено',
		})
	} catch (err) {
		return resError({ res, msg: err })
	}
})

/*
 *  Общие данные и аналитика об одном конкретном промокоде
 */
router.get('/count', verify.token, verify.isAdmin, async (req, res) => {
	const skip = +req.query.skip || 0
	const limit = +(req.query.limit > 0 && req.query.limit <= 20 ? req.query.limit : 20)

	const { _id, query } = req.query

	if (!_id) return resError({ res, msg: 'Не передан _id' })
	if (!isValidObjectId(_id)) return resError({ res, msg: 'Не валидный _id' })

	if (query && !isValidObjectId(query)) return resError({ res, msg: 'Не валидный userId' })

	try {
		const result = await Promocode.aggregate([
			{
				$match: {
					_id: mongoose.Types.ObjectId(_id),
				},
			},
			{
				$lookup: {
					from: 'tariffs',
					localField: 'tariffName',
					foreignField: 'name',
					pipeline: [
						{
							$project: {
								duration: true,
								_id: false,
							},
						},
					],
					as: 'tariff',
				},
			},
			{ $unwind: { path: '$tariff' } },
			{
				$lookup: {
					from: 'promocodeslogs',
					localField: '_id',
					foreignField: 'promocodeId',
					let: { tariffDuration: '$tariff.duration' },
					pipeline: [
						{
							$match: {
								...(query && {
									userId: mongoose.Types.ObjectId(query),
								}),
							},
						},
						{ $skip: skip },
						{ $limit: limit },
						{
							$lookup: {
								from: 'users',
								localField: 'userId',
								foreignField: '_id',
								pipeline: [
									{
										$project: {
											firstname: true,
											referral: true,
											phone: '$authPhone',
											tariffId: '$subscribe.tariffId',
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
														name: true,
													},
												},
											],
											as: 'tariff',
										},
									},
									{ $unwind: { path: '$tariff', preserveNullAndEmptyArrays: true } },
									{
										$project: {
											tariffName: '$tariff.name',
											role: true,
											avatar: true,
											firstname: true,
											lastname: true,
											referral: true,
											phone: true,
										},
									},
								],
								as: 'user',
							},
						},
						{ $unwind: { path: '$user' } },
						{
							$addFields: {
								isExpired: {
									$lt: [{ $add: ['$createdAt', '$$tariffDuration'] }, new Date()], // закончилось ли действие промокода
								},
							},
						},
						{
							$project: {
								userId: false,
								__v: false,
								updatedAt: false,
								promocodeId: false,
							},
						},
					],

					as: 'items',
				},
			},
			{
				$addFields: {
					sizeLogs: {
						$size: '$items',
					},
				},
			},
			{
				$project: {
					updatedAt: false,
					__v: false,
					tariff: false,
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
router.get('/countAll', verify.token, verify.isAdmin, getSearchQuery, async (req, res) => {
	const skip = +req.query.skip || 0
	const limit = +(req.query.limit > 0 && req.query.limit <= 20 ? req.query.limit : 20)

	const searchMatch = req.RegExpQuery && {
		value: req.RegExpQuery,
	}

	try {
		const activatedPromocodesAmount = await PromocodesLog.countDocuments({}) // Общее количество активированных когда либо промокодов

		Promocode.aggregate(
			[
				{
					$facet: {
						totalSize: [
							{ $match: { deleted: { $ne: true } } },
							{
								$group: {
									_id: null,
									count: { $sum: 1 },
								},
							},
							{ $project: { _id: false } },
							{ $limit: 1 },
						],
						totalSizeWithMatch: [
							{
								$match: {
									deleted: { $ne: true },
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
						totalSizeActiveNow: [
							{
								$match: {
									deleted: { $ne: true },
									isActive: true,
									startAt: { $lte: new Date() },
									$or: [
										{ finishAt: { $gte: new Date() } },
										{ finishAt: { $exists: false } },
										{ finishAt: null },
									],
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
						expired: [
							{
								$match: {
									deleted: { $ne: true },
									$and: [{ finishAt: { $exists: true } }, { finishAt: { $lte: new Date() } }],
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
									deleted: { $ne: true },
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
								$match: {
									...searchMatch,
									deleted: { $ne: true },
								},
							},
							{
								$project: {
									createdAt: true,
									value: true,
									startAt: true,
									finishAt: true,
									isActive: true,
									maxAmountActivation: true,
									currentAmountActivation: true,
									tariffName: true,
									discountFormat: true,
									sizeDiscount: true,
								},
							},
							{ $skip: skip },
							{ $limit: limit },
						],
					},
				},
				{ $limit: 1 },
				{ $unwind: { path: '$totalSize', preserveNullAndEmptyArrays: true } },
				{ $unwind: { path: '$totalSizeWithMatch', preserveNullAndEmptyArrays: true } },
				{ $unwind: { path: '$totalSizeActiveNow', preserveNullAndEmptyArrays: true } },
				{ $unwind: { path: '$totalSizeNotPublishedNow', preserveNullAndEmptyArrays: true } },
				{ $unwind: { path: '$expired', preserveNullAndEmptyArrays: true } },

				{
					$project: {
						totalSize: { $cond: ['$totalSize.count', '$totalSize.count', 0] },
						totalSizeWithMatch: {
							$cond: ['$totalSizeWithMatch.count', '$totalSizeWithMatch.count', 0],
						},
						totalSizeActiveNow: {
							$cond: ['$totalSizeActiveNow.count', '$totalSizeActiveNow.count', 0],
						},
						expired: {
							$cond: ['$expired.count', '$expired.count', 0],
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
