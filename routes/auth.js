const express = require('express')
const router = express.Router()
const axios = require('axios')
const jwt = require('jsonwebtoken')
const mongoose = require('mongoose')

const User = require('../models/user')
const AuthLog = require('../models/authLog')
const PhoneChecking = require('../models/phoneChecking')

const verify = require('../middlewares/verify')
const resError = require('../helpers/resError')
const resSuccess = require('../helpers/resSuccess')
const { uploadImageToS3 } = require('../helpers/uploadImage')
require('dotenv').config()

/*
 * Авторизация / регистрация через Яндекс и разрушение сессии
 */

const regex = /^7\d{10}$/ // проверка номера телефона: начинается с цифры 7 и состоит из 11 цифр

// Скачивание аватарки
const downloadAvatar = async (res, default_avatar_id) => {
	try {
		const { data } = await axios({
			method: 'GET',
			url: `https://avatars.yandex.net/get-yapic/${default_avatar_id}/islands-retina-50`,
			responseType: 'arraybuffer',
		})

		if (!data) return null

		// Конвертирование в JPEG и запись картинки на диск
		const { fileSrc } = await uploadImageToS3({
			res,
			buffer: data,
			width: 100,
			height: 100,
			fit: 'fill',
		})

		return fileSrc
	} catch (err) {
		console.log(err)
	}
}

// Генерация токена
const generateAccessToken = (userId) => {
	const payload = { id: userId }

	return jwt.sign(payload, process.env.JWT_TOKEN_SECRET, {
		expiresIn: '1year',
		algorithm: 'HS256',
	})
}

router.post('/login', async (req, res) => {
	const authorization = req.header('Authorization') || null
	let refererUserId = req.header('RefererUserId') || null

	if (!authorization) {
		return resError({
			res,
			alert: true,
			msg: 'Не получен authorization',
		})
	}

	try {
		axios({
			method: 'GET',
			url: 'https://login.yandex.ru/info?format=json',
			headers: {
				Authorization: authorization,
			},
		})
			.then(async (response) => {
				const { data } = response

				if (!data.id) return res.status(400).json(data)

				const {
					id,
					sex,
					birthday,
					last_name,
					client_id,
					first_name,
					display_name,
					default_email,
					default_phone,
					is_avatar_empty,
					default_avatar_id,
				} = data

				const defaultEmail = default_email.toLowerCase()

				// Поиск пользователя в БД
				let user = await User.findOne({ initial_id: id })

				// Если пользователя нет в БД, создаем нового
				if (!user) {
					// Скачать аватар с поставщика регистрации
					const avatar = !is_avatar_empty ? await downloadAvatar(res, default_avatar_id) : null

					user = await new User({
						initial_id: id,
						initial_sex: sex,
						initial_birthday: birthday,
						initial_lastname: last_name,
						initial_email: defaultEmail,
						initial_client_id: client_id,
						initial_firstname: first_name,
						initial_displayName: display_name,
						initial_phone: default_phone?.number,

						sex: sex,
						avatar: avatar,
						birthday: birthday,
						lastname: last_name,
						email: defaultEmail,
						firstname: first_name,
						displayName: display_name,
						phone: default_phone?.number,
						lastVisitAt: Date.now(),
					}).save()

					if (refererUserId) {
						// Поиск пользователя в БД, который пригласил на регистрацию
						const refererUser = await User.findOneAndUpdate(
							{ _id: refererUserId },
							{
								$addToSet: {
									'referral.userIds': user._id,
								},
							}
						)
						// Привязать пользователя к рефереру
						if (refererUser) {
							await User.updateOne({ _id: user._id }, { $set: { refererUserId } })
						}
					}
				}

				// Генерируем токен
				const userId = user._id
				const token = await generateAccessToken(userId)

				await User.updateOne(
					{ _id: userId },
					{
						$push: {
							sessions: {
								token,
								ip: req.ip,
								os: req.useragent.os,
								isBot: req.useragent.isBot,
								isMobile: req.useragent.isMobile,
								isDesktop: req.useragent.isDesktop,
								browser: req.useragent.browser,
								version: req.useragent.version,
								platform: req.useragent.platform,
								createdAt: Date.now(),
							},
						},
					}
				)

				// Логирование на создание запроса авторизации
				await new AuthLog({
					token,
					userId,
					type: 'LOGIN',
				}).save()

				const hostname = process.env.HOSTNAME
				const isLocalhost =
					hostname === 'localhost' && !req.headers.origin.endsWith('ngrok-free.app')

				res.cookie('token', token, {
					path: '/',
					priority: 'high',
					domain: hostname,
					maxAge: 31536000000,
					secure: !isLocalhost,
					sameSite: isLocalhost ? 'lax' : 'none',
				})

				res.cookie('authorizationType', 'yandex', {
					path: '/',
					priority: 'high',
					domain: hostname,
					maxAge: 31536000000,
					secure: !isLocalhost,
					sameSite: isLocalhost ? 'lax' : 'none',
				})

				return res.status(200).json({ token })
			})
			.catch((err) => {
				return resError({ res, msg: err })
			})
	} catch (error) {
		return res.json(error)
	}
})

/*
 * Выход из сессии
 */

router.post('/logout', verify.token, async (req, res) => {
	const { token } = req.body

	if (!token) {
		return resError({
			res,
			alert: true,
			msg: 'Не получен токен',
		})
	}

	if (req.user.token === token) {
		res.cookie('token', '', {
			maxAge: -1,
			domain: process.env.HOSTNAME,
		})
	}

	const isLogout = await User.findOne({
		_id: req.user._id,
		sessions: {
			$elemMatch: { token },
		},
	})

	if (!isLogout) {
		return resError({
			res,
			alert: true,
			msg: 'Сессия уже разрушена',
		})
	}

	// Логирование на выход из сессии
	new AuthLog({
		token,
		type: 'LOGOUT',
		userId: req.user._id,
	}).save()

	await User.updateOne(
		{ _id: req.user._id },
		{
			$pull: {
				sessions: { token },
			},
		}
	)
	return resSuccess({ res })
})

/*
 *  Отправка 4 значного кода через смс для авторизации / регистрации
 */

router.post('/sms/login', async (req, res) => {
	const { phone } = req.body

	const referer = req.header('Referer')
	const ip = req.ip

	try {
		// if (referer !== process.env.REFERER && referer !== process.env.DEV_REFERER) {
		// 	return resError({
		// 		res,
		// 		alert: true,
		// 		msg: 'С вашего адреса запрос запрещен',
		// 	})
		// }

		// if (req.useragent?.isBot) {
		// 	return resError({
		// 		res,
		// 		alert: true,
		// 		msg: 'Обнаружен бот',
		// 	})
		// }

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

		let DayAgo = new Date()
		DayAgo.setDate(DayAgo.getDate() - 1)

		// const previousPhoneChecking = await PhoneChecking.find({
		// 	$or: [{ phone }, { ip }],
		// 	createdAt: { $gt: DayAgo },
		// })

		// if (previousPhoneChecking.length >= 10) {
		// 	return resError({
		// 		res,
		// 		alert: true,
		// 		msg: 'Превышено число авторизаций за сутки',
		// 	})
		// }

		const code = Math.floor(1000 + Math.random() * 9000) // 4 значный код для подтверждения
		await PhoneChecking.updateMany(
			{ phone, code: { $ne: code }, type: 'authorization' },
			{ $set: { isCancelled: true } }
		)

		// Создание записи в журнале авторизаций через смс
		await PhoneChecking.create({
			phone,
			code,
			isConfirmed: false,
			attemptAmount: 3,
			ip,
			isCancelled: false,
			type: 'authorization',
		})

		const response = await fetch(
			`https://smsc.ru/sys/send.php?login=${process.env.LOGIN}&psw=${process.env.PASSWORD}&phones=${phone}&mes=${code}`
		)

		if (response.status === 200) {
			return resSuccess({ res, msg: 'Сообщение с кодом отправлено по указанному номеру телефона' })
		} else {
			return resError({
				res,
				alert: true,
				msg: 'Что-то пошло не так. Попробуйе позже',
			})
		}
	} catch (error) {
		return res.json(error)
	}
})

/*
 *  Проверка 4 значного кода через смс для для авторизации / регистрации
 */
router.post('/sms/compare', async (req, res) => {
	const { code, phone } = req.body
	let refererUserId = req.header('RefererUserId') || null

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

	let DayAgo = new Date()
	DayAgo.setDate(DayAgo.getDate() - 1)

	const phoneCheckingLog = await PhoneChecking.findOne({
		phone,
		isConfirmed: false,
		isCancelled: false,
		type: 'authorization',
		createdAt: { $gt: DayAgo },
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

		// Получение данных пользователя, если он авторизован
		await verify.token(req)

		if (req.user) {
			await User.findOneAndUpdate(
				{ _id: req.user._id },
				{
					phone,
				}
			)

			await User.updateMany({ phone, _id: { $ne: req.user._id } }, { $set: { phone: null } })

			return resSuccess({ res, msg: 'Номер телефона привязан' })
		}

		// Поиск пользователя в БД
		let user = await User.findOne({ phone })

		// Если пользователя нет в БД, создаем нового
		if (!user) {
			user = await new User({
				phone,
				lastVisitAt: Date.now(),
			}).save()

			if (refererUserId) {
				// Поиск пользователя в БД, который пригласил на регистрацию
				const refererUser = await User.findOneAndUpdate(
					{ _id: refererUserId },
					{
						$addToSet: {
							'referral.userIds': user._id,
						},
					}
				)
				// Привязать пользователя к рефереру
				if (refererUser) {
					await User.updateOne({ _id: user._id }, { $set: { refererUserId } })
				}
			}
		}

		// Генерируем токен
		const userId = user._id
		const token = await generateAccessToken(userId)

		await User.updateOne(
			{ _id: userId },
			{
				$push: {
					sessions: {
						token,
						ip: req.ip,
						os: req.useragent.os,
						isBot: Boolean(req.useragent.isBot),
						isMobile: req.useragent.isMobile,
						isDesktop: req.useragent.isDesktop,
						browser: req.useragent.browser,
						version: req.useragent.version,
						platform: req.useragent.platform,
						createdAt: Date.now(),
					},
				},
			}
		)

		// Логирование на создание запроса авторизации
		await new AuthLog({
			token,
			userId,
			type: 'LOGIN',
		}).save()

		const hostname = process.env.HOSTNAME
		const isLocalhost = hostname === 'localhost' && !req.headers.origin?.endsWith('ngrok-free.app')

		res.cookie('token', token, {
			path: '/',
			priority: 'high',
			domain: hostname,
			maxAge: 31536000000,
			secure: !isLocalhost,
			sameSite: isLocalhost ? 'lax' : 'none',
		})

		res.cookie('authorizationType', 'sms', {
			path: '/',
			priority: 'high',
			domain: hostname,
			maxAge: 31536000000,
			secure: !isLocalhost,
			sameSite: isLocalhost ? 'lax' : 'none',
		})

		return res.status(200).json({ token })
	} else {
		return resError({
			res,
			alert: true,
			msg: 'Для данного номера телефона нет действующего кода подтверждения. Запросите код подтверждения повторно',
		})
	}
})

module.exports = router
