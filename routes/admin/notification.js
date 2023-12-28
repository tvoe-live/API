const express = require('express')
const multer = require('multer')
const resError = require('../../helpers/resError')
const Notification = require('../../models/notification')
const getSearchQuery = require('../../middlewares/getSearchQuery')
const verify = require('../../middlewares/verify')
const { uploadImageToS3 } = require('../../helpers/uploadImage')
const router = express.Router()

const resSuccess = require('../../helpers/resSuccess')
// const getBoolean = require('../../helpers/getBoolean')
const mongoose = require('mongoose')

// Загрузка картинки в буффер
const memoryStorage = multer.memoryStorage()
const uploadMemoryStorage = multer({ storage: memoryStorage })

/*
 *  Уведомления
 */

const filterNotificationOptions = {
	system: { type: 'SERVICE_NEWS' },
	discount: { type: 'GIFTS_AND_PROMOTIONS' },
	profile: { type: 'PROFILE' },
	unique: { type: 'CINEMA_NEWS' },
}

/*
 * Список всех уведомлений
 */
router.get('/', getSearchQuery, verify.token, verify.isAdmin, async (req, res) => {
	const skip = +req.query.skip || 0
	const limit = +(req.query.limit > 0 && req.query.limit <= 20 ? req.query.limit : 20)

	const query = req.searchQuery?.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
	const editSpace = query?.replace(/ /gi, '\\s.*')
	const RegExpQuery = new RegExp(editSpace?.replace(/[её]/gi, '[её]'), 'i')

	const notificationFilterParams =
		req.query.status && filterNotificationOptions[`${req.query.status}`]
	const dateFilterParam = req.query.start && {
		$and: [
			{ createdAt: { $gte: new Date(req.query.start) } },
			{ createdAt: { $lt: new Date(req.query.end ? req.query.end : new Date()) } },
		],
	}

	try {
		Notification.aggregate(
			[
				{
					$facet: {
						totalSize: [
							{
								$match: {
									deleted: { $ne: true },
									...(RegExpQuery && { title: RegExpQuery }),
									...notificationFilterParams,
									...dateFilterParam,
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
							{
								$match: {
									deleted: { $ne: true },
									...(RegExpQuery && { title: RegExpQuery }),
									...notificationFilterParams,
									...dateFilterParam,
								},
							},
							{
								$project: {
									receiversIds: false,
									__v: false,
								},
							},
							{
								$addFields: {
									status: {
										$cond: {
											if: {
												$or: [
													// Если этого поля не существует или оно равно null
													{ $eq: ['$willPublishedAt', null] },
													{ $eq: [{ $ifNull: ['$willPublishedAt', null] }, null] },
												],
											},
											then: 'сохранено',
											else: {
												$cond: {
													if: { $gt: ['$willPublishedAt', new Date()] },
													then: 'отложено',
													else: 'опубликовано',
												},
											},
										},
									},
								},
							},
							{ $sort: { createdAt: -1 } },
							{
								$project: {
									createdAt: false,
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
 * Создать уведомления
 */

router.post(
	'/',
	verify.token,
	verify.isManager,
	uploadMemoryStorage.single('file'),
	async (req, res) => {
		const buffer = req?.file?.buffer

		const { title, description, type, willPublishedAt, link, receiversIds } = req.body

		if (!title) return resError({ res, msg: 'Не передан title' })
		if (!type) return resError({ res, msg: 'Не передан type' })
		if (!willPublishedAt)
			return resError({
				res,
				msg: 'Не передана дата и время публикации - параметр willPublishedAt',
			})

		let fileIdForDB
		let fileSrcForDB

		if (buffer) {
			const { fileId, fileSrc } = await uploadImageToS3({
				res,
				buffer,
			})

			fileIdForDB = fileId
			fileSrcForDB = fileSrc
		}

		try {
			const response = await Notification.create({
				title,
				description,
				type,
				link,
				receiversIds,
				willPublishedAt: new Date(willPublishedAt),
				img: {
					_id: fileIdForDB,
					src: fileSrcForDB,
				},
			})

			return res.status(200).json({
				success: true,
				id: response._id,
				title,
				description,
				link,
				type,
				receiversIds,
				willPublishedAt,
				img: response.img,
			})
		} catch (err) {
			return resError({ res, msg: err })
		}
	}
)

/*
 * Изменить уведомление
 */
router.patch('/', verify.token, uploadMemoryStorage.single('file'), async (req, res) => {
	const buffer = req.file?.buffer
	const { title, description, _id, type, willPublishedAt, link, receiversIds } = req.body

	try {
		const notification = await Notification.findOne({ _id })

		if (!notification) {
			return resError({ res, msg: 'Уведомление с указанным _id не найдено' })
		}

		if (buffer) {
			const pathToFileIng = notification?.src
			// Удаление файла картинки
			if (pathToFileIng) await deleteFileFromS3(pathToFileIng)

			const { fileId, fileSrc } = await uploadImageToS3({
				res,
				buffer,
			})

			notification.img = {
				_id: fileId,
				src: fileSrc,
			}
		}

		if (title) notification.title = title
		if (description) notification.description = description
		if (type) notification.type = type
		if (willPublishedAt) notification.willPublishedAt = willPublishedAt
		if (link) notification.link = link
		if (receiversIds) notification.receiversIds = receiversIds

		notification.save()

		return resSuccess({
			res,
			alert: true,
			msg: 'Уведомление обновлено',
		})
	} catch (err) {
		return resError({ res, msg: err })
	}
})

/*
 * Удалить уведомления
 */
router.delete('/', verify.token, verify.isManager, async (req, res) => {
	const { _id } = req.body

	if (!_id) return resError({ res, msg: 'Не передан _id' })

	try {
		const notification = await Notification.findOne({ _id })

		if (!notification) {
			return resError({ res, msg: 'Уведомление с указанным _id не найдено' })
		}

		const pathToFileIng = notification?.src
		// Удаление файла картинки
		if (pathToFileIng) await deleteFileFromS3(pathToFileIng)

		// Удаление записи из БД
		// notification.delete()
		notification.deleted = true
		notification.save()

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
 *  Количество просмотров у одного уведомления
 */
router.get('/count', verify.token, verify.isManager, async (req, res) => {
	const id = req.query.id
	if (!id) return resError({ res, msg: 'Не передан id' })

	try {
		const result = await NotificationReadLog.aggregate([
			{
				$facet: {
					totalSize: [
						{
							$match: {
								notificationId: mongoose.Types.ObjectId(id),
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
					id: id,
				},
			},
		])

		return res.status(200).json(result[0])
	} catch (err) {
		return resError({ res, msg: err })
	}
})

/*
 *  Количество просмотров у всех уведомлений
 */
router.get('/countAll', verify.token, verify.isManager, async (req, res) => {
	const skip = +req.query.skip || 0
	const limit = +(req.query.limit > 0 && req.query.limit <= 20 ? req.query.limit : 20)

	const lookup = {
		$lookup: {
			from: 'notificationreadlogs',
			localField: '_id',
			foreignField: 'notificationId',
			as: 'NotificationReadLog',
		},
	}

	try {
		Notification.aggregate(
			[
				{
					$facet: {
						totalSize: [
							lookup,
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
							lookup,
							{ $sort: { updatedAt: -1 } },
							{
								$project: {
									updatedAt: true,
									title: true,
									description: true,
									type: true,
									img: true,
									watchingAmount: { $size: '$NotificationReadLog' },
								},
							},
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
			],
			async (err, result) => {
				return res.status(200).json(result[0])
			}
		)
	} catch (err) {
		return resError({ res, msg: err })
	}
})

module.exports = router
