const express = require('express')
const router = express.Router()
const multer = require('multer')
const User = require('../../models/user')
const Tariff = require('../../models/tariff')
const Notification = require('../../models/notification')
const PhoneChecking = require('../../models/phoneChecking')
const UserDeletionLog = require('../../models/userDeletionLog')

const verify = require('../../middlewares/verify')
const resError = require('../../helpers/resError')
const resSuccess = require('../../helpers/resSuccess')
const { uploadImageToS3 } = require('../../helpers/uploadImage')
const { deleteFileFromS3 } = require('../../helpers/deleteFile')
const { AMOUNT_LOGIN_WITHOUT_CAPTCHA } = require('../../constants')

/*
 * Профиль > Основное
 */

const regex = /^7\d{10}$/ // проверка номера телефона: начинается с цифры 7 и состоит из 11 цифр

// Загрузка картинок в буффер
const memoryStorage = multer.memoryStorage()
const uploadMemoryStorage = multer({ storage: memoryStorage })

// Получение профиля
router.get('/', verify.token, async (req, res) => {
	const user = await User.findOne(
		{ _id: req.user._id },
		{
			role: true,
			email: true,
			avatar: true,
			deleted: true,
			firstname: true,
			subscribe: true,
			allowTrialTariff: true,
			disabledNotifications: true,
			authPhone: true,
			autoPayment: true,
		}
	)

	if (user.deleted?.finish && new Date().getTime() > new Date(user.deleted.finish).getTime()) {
		user.deleted.timeIsUp = true
	}

	if (user.subscribe && user.subscribe?.tariffId) {
		const { name: tariffName } = await Tariff.findOne(
			{ _id: user.subscribe?.tariffId },
			{ name: true }
		)
		user.subscribe = { ...user.subscribe, tariffName }
	}

	return res.status(200).json(user)
})

// Изменение имени в профиле
router.patch('/', verify.token, async (req, res) => {
	let { firstname } = req.body

	if (typeof firstname === 'undefined') {
		return resError({
			res,
			alert: true,
			msg: 'Обязательно наличие поля firstname',
		})
	}

	firstname = firstname.toString()

	if (firstname.length > 50) {
		return resError({
			res,
			alert: true,
			msg: 'Превышена длина поля: Имя пользователя',
		})
	}

	await User.updateOne(
		{ _id: req.user._id },
		{
			$set: { firstname },
			$inc: { __v: 1 },
		}
	)

	return resSuccess({
		res,
		alert: true,
		msg: 'Имя пользователя обновлено',
	})
})

// Изменение номера телефона в профиле
router.patch('/phone', verify.token, async (req, res) => {
	const { phone, imgcode } = req.body
	const userId = req.user._id
	const ip = req.headers['x-real-ip']

	try {
		if (req.useragent?.isBot) {
			return resError({
				res,
				alert: true,
				msg: 'Обнаружен бот',
			})
		}

		if (!phone) {
			return resError({
				res,
				alert: true,
				msg: 'Не получен phone',
			})
		}

		if (!regex.test(phone)) {
			return resError({
				res,
				alert: true,
				msg: 'Номер телефона должен начинаться с "7" и состоять из 11 цифр',
			})
		}

		if (phone === req.user.authPhone) {
			return resError({
				res,
				alert: true,
				msg: 'К аккаунту уже привязан этот номер телефона',
			})
		}

		let minuteAgo = new Date()
		minuteAgo.setSeconds(minuteAgo.getSeconds() - 90)

		const previousPhoneCheckingMinute = await PhoneChecking.find({
			userId,
			type: 'change',
			createdAt: { $gt: minuteAgo },
		})

		if (!!previousPhoneCheckingMinute.length) {
			return resError({
				res,
				alert: true,
				msg: 'Можно запросить код подтверждения только раз в 90 секунд',
			})
		}

		let DayAgo = new Date()
		DayAgo.setDate(DayAgo.getDate() - 1)

		const previousPhoneChecking = await PhoneChecking.find({
			userId,
			createdAt: { $gt: DayAgo },
			type: 'change',
		})

		// if (previousPhoneChecking.length >= 3) {
		// 	return resError({
		// 		res,
		// 		alert: true,
		// 		msg: 'Превышен лимит изменения номера телефона за сутки',
		// 	})
		// }

		const prevPhoneChecking2 = await PhoneChecking.find({
			phone,
		})
			.sort({ createdAt: -1 })
			.limit(AMOUNT_LOGIN_WITHOUT_CAPTCHA)

		const prevIpChecking = await PhoneChecking.find({
			ip,
		})
			.sort({ createdAt: -1 })
			.limit(AMOUNT_LOGIN_WITHOUT_CAPTCHA)

		//Если последние 2 заявки на подтверждения для указанного номера телефона или ip адреса клиента не были подтверждены правильным смс кодом, необходимо показать капчу
		if (
			(prevPhoneChecking2.length === AMOUNT_LOGIN_WITHOUT_CAPTCHA &&
				prevPhoneChecking2.every((log) => !log.isConfirmed) &&
				!imgcode) ||
			(prevIpChecking.length === AMOUNT_LOGIN_WITHOUT_CAPTCHA &&
				prevIpChecking.every((log) => !log.isConfirmed) &&
				!imgcode)
		) {
			return resError({
				res,
				alert: false,
				msg: 'Требуется imgcode',
			})
		}

		const code = Math.floor(1000 + Math.random() * 9000) // 4 значный код для подтверждения
		await PhoneChecking.updateMany(
			{ phone, code: { $ne: code }, type: 'change', userId },
			{ $set: { isCancelled: true } }
		)

		// Создание записи в журнале авторизаций через смс
		await PhoneChecking.create({
			phone,
			code,
			isConfirmed: false,
			attemptAmount: 3,
			isCancelled: false,
			type: 'change',
			userId,
		})

		const url = imgcode
			? `https://smsc.ru/sys/send.php?login=${process.env.SMS_SERVICE_LOGIN}&psw=${process.env.SMS_SERVICE_PASSWORD}&phones=${phone}&mes=${code}&imgcode=${imgcode}&userip=${ip}&op=1`
			: `https://smsc.ru/sys/send.php?login=${process.env.SMS_SERVICE_LOGIN}&psw=${process.env.SMS_SERVICE_PASSWORD}&phones=${phone}&mes=${code}`

		const response = await fetch(url)

		const responseText = await response?.text()

		if (responseText.startsWith('ERROR = 10')) {
			return resError({
				res,
				alert: true,
				msg: 'Символы указаны неверно',
			})
		}

		if (response.status === 200) {
			return resSuccess({
				res,
				msg: 'Сообщение с кодом отправлено по указанному номеру телефона',
				alert: true,
			})
		}

		return resError({
			res,
			alert: true,
			msg: 'Что-то пошло не так. Попробуйте позже',
		})
	} catch (error) {
		return res.json(error)
	}
})

/*
 *  Проверка 4 значного кода через смс для для смены номера телефона
 */
router.post('/change-phone/compare', verify.token, async (req, res) => {
	const { code, phone } = req.body

	if (!code) {
		return resError({
			res,
			alert: true,
			msg: 'Не получен 4 значный код',
		})
	}

	if (!phone) {
		return resError({
			res,
			alert: true,
			msg: 'Не получен phone',
		})
	}

	if (!regex.test(phone)) {
		return resError({
			res,
			alert: true,
			msg: 'Номер телефона должен начинаться с "7" и состоять из 11 цифр',
		})
	}

	if (code.toString().length !== 4) {
		return resError({
			res,
			alert: true,
			msg: 'Код должен быть 4 значным',
		})
	}

	let hourAgo = new Date()
	hourAgo.setHours(hourAgo.getHours() - 1)

	const phoneCheckingLog = await PhoneChecking.findOne({
		phone,
		isConfirmed: false,
		isCancelled: false,
		type: 'change',
		createdAt: { $gt: hourAgo },
		userId: req.user._id,
	})

	if (phoneCheckingLog) {
		if (phoneCheckingLog.attemptAmount === 0) {
			return resError({
				res,
				alert: true,
				msg: 'Исчерпано количество попыток. Запросите новый код',
			})
		}

		phoneCheckingLog.attemptAmount -= 1
		await phoneCheckingLog.save()

		if (code !== phoneCheckingLog.code) {
			return resError({
				res,
				alert: true,
				msg: 'Неверный код подтверждения',
			})
		}

		phoneCheckingLog.isConfirmed = true
		await phoneCheckingLog.save()

		// Поиск пользователя в БД и установление ему нового номера телефона
		await User.findOneAndUpdate(
			{
				_id: req.user._id,
			},
			{
				$set: {
					authPhone: phone,
				},
				$inc: { __v: 1 },
			}
		)

		// Обнулить телефон у другого юзера, если он существует, с таким номером телефона
		await User.findOneAndUpdate(
			{
				_id: { $ne: req.user._id },
				authPhone: phone,
			},
			{
				$set: {
					authPhone: null,
				},
				$inc: { __v: 1 },
			}
		)

		return res.status(200).json({ alert: true, msg: 'Номер телефона обновлен', success: true })
	} else {
		return resError({
			res,
			alert: true,
			msg: 'Для данного номера телефона нет действующего кода подтверждения. Запросите код подтверждения повторно',
		})
	}
})

// Удаление профиля
router.delete('/', verify.token, async (req, res) => {
	const { _id, deleted, subscribe } = req.user

	const { isRefund, reason } = req.body

	if (deleted) {
		return resError({
			res,
			alert: true,
			msg: 'Профиль уже в режиме удаления',
		})
	}

	let refundAmount

	try {
		if (isRefund) {
			if (!subscribe || subscribe.finishAt < Date.now()) {
				return resError({
					res,
					alert: true,
					msg: 'У вас нет действующей подписки, вернуть средства не представляется возможным',
				})
			}

			const generalAmountDaysSubscribtion = Math.ceil(
				(subscribe.finishAt - subscribe.startAt) / (1000 * 60 * 60 * 24)
			) //Общее количество дней подписки
			const restAmountDaysSubscribtion = Math.ceil(
				(subscribe.finishAt - Date.now()) / (1000 * 60 * 60 * 24)
			) //Оставшееся количество дней подписки
			const { price } = await Tariff.findOne({ _id: subscribe.tariffId })
			refundAmount = Math.floor(
				(restAmountDaysSubscribtion / generalAmountDaysSubscribtion) * price
			) //Cумма для возврата пользователю за неиспользованные дни подписки
		}

		await UserDeletionLog.create({
			userId: _id,
			refundAmount,
			reason,
			isRefund,
			...(isRefund && { refundStatus: 'WAITING' }),
		})

		const now = new Date()
		const finish = now.setMonth(now.getMonth() + 1)

		const set = {
			deleted: {
				start: new Date(),
				finish: new Date(finish),
			},
		}

		const dayBeforeRemoving = new Date(finish)
		dayBeforeRemoving.setDate(dayBeforeRemoving.getDate() - 1)

		const description =
			'Ваш аккаунт на кинохостинге https://tvoe.live/ завтра будет полностью удален'

		// Создание индивидуального уведомления-напоминания для пользователя
		Notification.create({
			title: 'Напоминание',
			description,
			type: 'PROFILE',
			receiversIds: [_id],
			willPublishedAt: dayBeforeRemoving,
		})

		// Функционал по отправке сообщения напоминания вроде как больше не нужен.
		// if (authPhone) {
		// 	await DisposableCronTask.create({
		// 		name: 'sendMsgViaPhone',
		// 		phone: authPhone,
		// 		message,
		// 		willCompletedAt: dayBeforeRemoving,
		// 	})

		// 	schedule.scheduleJob(new Date(dayBeforeRemoving), async function () {
		// 		const response = await fetch(
		// 			`https://smsc.ru/sys/send.php?login=${process.env.SMS_SERVICE_LOGIN}&psw=${process.env.SMS_SERVICE_PASSWORD}&phones=${authPhone}&mes=${message}`
		// 		)
		// 	})
		// } else if (email) {
		// 	await DisposableCronTask.create({
		// 		name: 'sendMsgViaEmail',
		// 		email,
		// 		message,
		// 		willCompletedAt: dayBeforeRemoving,
		// 	})

		// 	const msg = {
		// 		to: email,
		// 		subject: 'Напоминание',
		// 		text: message,
		// 	}

		// 	schedule.scheduleJob(dayBeforeRemoving, async function () {
		// 		mailer(msg)
		// 	})
		// }

		await User.updateOne({ _id: _id }, { $set: set })

		return res.status(200).json({ ...set })
	} catch (err) {
		return resError({ res, msg: err })
	}
})

// Восстановление профиля
router.post('/recover', verify.token, async (req, res) => {
	const { _id, deleted } = req.user

	if (new Date().getTime() > deleted.finish.getTime()) {
		return resError({
			res,
			alert: true,
			msg: 'Профиль уже полностью удален',
		})
	}

	const unset = {
		deleted: null,
	}

	await User.updateOne({ _id: _id }, { $unset: unset })

	return res.status(200).json({ ...unset })
})

// Загрузка аватара
router.post('/avatar', verify.token, uploadMemoryStorage.single('file'), async (req, res) => {
	const { buffer } = req.file
	const maxSizeMbyte = 5 // Лимит 5MB
	const maxSizeByte = maxSizeMbyte * 1024 * 1024

	if (!buffer) return resError({ res, msg: 'Фаил не получен' })
	if (req.file.buffer.byteLength >= maxSizeByte) {
		return resError({
			res,
			alert: true,
			msg: `Размер файла не должен превышать ${maxSizeMbyte} МБ`,
		})
	}

	const { fileSrc } = await uploadImageToS3({
		res,
		buffer,
		width: 100,
		height: 100,
		fit: 'fill',
	})

	// Добавление / обновление ссылки на фаил в БД
	const user = await User.findOneAndUpdate(
		{ _id: req.user._id },
		{
			$set: {
				avatar: fileSrc,
			},
		}
	)

	// Удаление старого файла
	if (user.avatar) await deleteFileFromS3(user.avatar)

	return resSuccess({
		res,
		alert: true,
		src: fileSrc,
		msg: 'Аватар обновлен',
	})
})

// Удаление аватара
router.delete('/avatar', verify.token, async (req, res) => {
	// Удаление ссылки на фаил в БД
	const user = await User.findOneAndUpdate(
		{ _id: req.user._id },
		{
			$set: {
				avatar: null,
			},
		}
	)

	// Удаление старого файла
	if (user.avatar) await deleteFileFromS3(user.avatar)

	return resSuccess({
		res,
		src: null,
		alert: true,
		msg: 'Аватар удален',
	})
})

module.exports = router
