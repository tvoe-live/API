const express = require('express')
const router = express.Router()
const verify = require('../../middlewares/verify')
const resError = require('../../helpers/resError')
const Notification = require('../../models/notification')
const User = require('../../models/user')
const NotificationReadLog = require('../../models/notificationReadLog')
const resSuccess = require('../../helpers/resSuccess')
const multer = require('multer')
const mongoose = require('mongoose')
const isValidObjectId = require('../../helpers/isValidObjectId')

// Загрузка картинки в буффер
const memoryStorage = multer.memoryStorage()

/*
 * Уведомления
 */

/*
 * Список уведомлений для пользователя
 */
router.get('/', verify.token, async (req, res) => {
	const skip = +req.query.skip || 0
	const limit = +(req.query.limit > 0 && req.query.limit <= 20 ? req.query.limit : 20)
	const lookupAndMatch = [
		{
			$match: {
				$and: [
					{
						$or: [
							{ receiversIds: [] }, // Поле является пустым массивом
							{ receiversIds: { $elemMatch: { $eq: req.user._id } } }, // Поле содержит заданный id
						],
					},
					{
						type: {
							$nin: req.user.disabledNotifications,
						},
					},
					{
						$expr: {
							$and: [
								{ $gte: [new Date(), '$willPublishedAt'] },
								{ $ne: ['$deleted', true] },
								{ $gte: ['$createdAt', req.user.createdAt] },
							],
						},
					},
				],
			},
		},
		{
			$lookup: {
				from: 'notificationreadlogs',
				localField: '_id',
				foreignField: 'notificationId',
				pipeline: [
					{
						$match: {
							userId: req.user._id,
						},
					},
				],
				as: 'notificationReadLog',
			},
		},
	]

	try {
		Notification.aggregate(
			[
				{
					$facet: {
						totalSize: [
							...lookupAndMatch,
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
							...lookupAndMatch,
							{
								$project: {
									title: '$title',
									description: '$description',
									type: '$type',
									willPublishedAt: '$willPublishedAt',
									isReaded: {
										$cond: {
											if: { $eq: [{ $size: '$notificationReadLog' }, 0] },
											then: false,
											else: true,
										},
									},
								},
							},
							{ $sort: { isReaded: 1, willPublishedAt: -1 } },
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
 * Пометить уведомления прочитанными
 */
router.patch('/markAsRead', verify.token, async (req, res) => {
	const userId = mongoose.Types.ObjectId(req.user._id)

	const NotificationReadLogForInsert = []

	for (id of req.body.ids) {
		if (!isValidObjectId(id)) {
			return resError({
				res,
				alert: true,
				msg: 'Не валидное значение notificationId',
			})
		}

		const notificationId = mongoose.Types.ObjectId(id)

		const notification = await Notification.findOne({ _id: notificationId })
		if (!notification)
			return resError({ res, msg: `Уведомление с id = ${notificationId} не найдено` })

		const notificationReadLog = await NotificationReadLog.findOne({
			notificationId,
			userId: req.user._id,
		})

		if (!notificationReadLog) {
			NotificationReadLogForInsert.push({
				notificationId,
				userId,
			})
		}
	}

	try {
		await NotificationReadLog.insertMany(NotificationReadLogForInsert)

		return res.status(200).json()
	} catch (err) {
		return resError({ res, msg: err })
	}
})

router.patch('/settings', verify.token, async (req, res) => {
	const notificationTypes = [
		'SERVICE_NEWS', // Новости сервиса - уведомления о технических работах на сайте и новинках обновленного сервиса
		'GIFTS_AND_PROMOTIONS', // Подарки и акции - бонусы для пользователей
		'PROFILE', // Профиль - напоминание об окончании подписки и индивидуальные предложения
		'CINEMA_NEWS', // Новинки кинематографа
		'SERVICE_NOVELTIES', // Новинки на сервисе
		'FAVOTITES_AND_BOOKMARKS_NEWS', // Новинки из раздела "избранное" и "буду смотреть"
	]

	Object.keys(req.body).forEach((notificationType) => {
		if (!notificationTypes.includes(notificationType)) {
			return resError({
				res,
				alert: true,
				msg: `${notificationType} - не валидное значение. Возможные варианты: ${notificationTypes}`,
			})
		}
	})

	const turnOn = Object.entries(req.body)
		.filter((arr) => arr[1])
		.map((arr) => arr[0])
	const turnOff = Object.entries(req.body)
		.filter((arr) => !arr[1])
		.map((arr) => arr[0])

	try {
		const user = await User.findOne({ _id: req.user.id })

		let newDisabledNotifications = Array.from(new Set([...user.disabledNotifications, ...turnOff]))
		newDisabledNotifications = newDisabledNotifications.filter((kind) => !turnOn.includes(kind))

		user.disabledNotifications = newDisabledNotifications
		user.save()

		return resSuccess({
			res,
			alert: true,
			msg: 'Успешно обновлено',
		})
	} catch (err) {
		return resError({ res, msg: err })
	}
})

module.exports = router
