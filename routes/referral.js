const { CLIENT_URL, FIRST_STEP_REFERRAL, SECOND_STEP_REFERRAL } = process.env

const express = require('express')
const router = express.Router()

const User = require('../models/user')
const PaymentLog = require('../models/paymentLog')
const ReferralWithdrawalLog = require('../models/referralWithdrawalLog')

const verify = require('../middlewares/verify')

const resError = require('../helpers/resError')
const resSuccess = require('../helpers/resSuccess')

/*
 * Реферальная программа
 */

/*
 * Получение общих данных
 */
router.get('/', async (req, res) => {
	// Получение данных пользователя, если он авторизован
	await verify.token(req)

	const authedUser = !!req.user // Авторизован ли пользователь? true / false
	const link = authedUser ? `${CLIENT_URL}/?r=${req.user._id}` : null // Реферальная ссылка
	const card = authedUser ? req.user.referral.card : '' // Данные карты для вывода баланса
	const balance = authedUser ? req.user.referral.balance : 0 // Текущий баланс с подписок рефералов
	let referralUsersFirstLvl = [] // Реферальные пользователи 1-го уровня
	let referralUsersSecondLvl = [] // Реферальные пользователи 2-го уровня
	let authCount = 0 // Общее количество реферальных пользователей

	try {
		if (authedUser) {
			const user = await User.findById(req.user._id, { referral: true }).lean()
			if (user.referral) {
				// Получение реф.пользователей 1-го уровня
				referralUsersFirstLvl = await User.find(
					{ _id: { $in: user.referral.userIds } },
					{ _id: true, referral: true }
				).lean()

				// Получение реф.пользователей 2-го уровня
				const referralUsersSecondLvlPromises = referralUsersFirstLvl
					.filter((usr) => usr.referral)
					.map((usr) => user.find({ _id: { $in: usr.referral.userIds } }, { _id: true }).lean())
				referralUsersSecondLvl = (await Promise.all(referralUsersSecondLvlPromises)).reduce(
					(acc, item) => acc.concat(item),
					[]
				)

				authCount = referralUsersFirstLvl.length + referralUsersSecondLvl.length
			}
		}

		return resSuccess({
			res,
			balance,
			firstLvlReferrals: referralUsersFirstLvl.length,
			secondLvlReferrals: referralUsersSecondLvl.length,
			authCount,
			link,
			card,
		})
	} catch (err) {
		return resError({ res, msg: err })
	}
})

/*
 * Список "Мои рефералы"
 */
router.get('/invitedReferrals', verify.token, async (req, res) => {
	try {
		// Получение данных пользователя
		const user = await User.findById(req.user._id, { _id: true, referral: true }).lean()

		// Получение данных реф.пользователей 1го уровня
		const refferalUsersFirstLvl = await User.find(
			{ _id: { $in: user.referral.userIds } },
			{ _id: true, referral: true }
		)

		// Получение данных об оплате тарифов реф.пользователей 1го уровня
		const refferalUsersFirstLvlPaymentLogPromises = refferalUsersFirstLvl.map((usr) =>
			PaymentLog.find(
				{
					userId: usr._id,
					$or: [{ status: 'CONFIRMED' }, { status: 'success' }, { status: 'AUTHORIZED' }],
					type: 'paid',
					createdAt: { $gte: new Date('2023-11-21') },
				},
				{ userId: true, tariffId: true, _id: false, amount: true, createdAt: true }
			)
				.populate('tariffId', ['name'])
				.populate('userId', ['firstname', 'lastname', 'avatar'])
				.lean()
		)

		const refferalUsersFirstLvlPaymentLog = (
			await Promise.all(refferalUsersFirstLvlPaymentLogPromises)
		)
			.reduce((acc, item) => acc.concat(item), [])
			.map((item) => {
				item.amount = Number((item.amount * (FIRST_STEP_REFERRAL / 100)).toFixed(2))
				return { ...item, lvl: '1 уровень' }
			})

		// Получение данных реф.пользователей 2го уровня
		const referalUsersSecondLvlPromises = refferalUsersFirstLvl.map((usr) =>
			User.find(
				{
					$and: [{ _id: { $in: usr.referral.userIds } }, { _id: { $not: { $eq: user._id } } }],
				},
				{ _id: true }
			)
		)
		const refferalUsersSecondLvl = (await Promise.all(referalUsersSecondLvlPromises)).reduce(
			(acc, item) => acc.concat(item),
			[]
		)

		// Получение данных об оплате тарифов реф.пользователей 2го уровня
		const refferalUsersSecondLvlPaymentLogPromises = refferalUsersSecondLvl.map((usr) =>
			PaymentLog.find(
				{
					userId: usr._id,
					$or: [{ status: 'CONFIRMED' }, { status: 'success' }, { status: 'AUTHORIZED' }],
					type: 'paid',
					createdAt: { $gte: new Date('2023-08-16') },
				},
				{ userId: true, tariffId: true, _id: false, amount: true, createdAt: true }
			)
				.populate('tariffId', ['name'])
				.populate('userId', ['firstname', 'lastname', 'avatar'])
				.lean()
		)

		const refferalUsersSecondLvlPaymentLog = (
			await Promise.all(refferalUsersSecondLvlPaymentLogPromises)
		)
			.reduce((acc, item) => acc.concat(item), [])
			.map((item) => {
				item.amount = Number((item.amount * (SECOND_STEP_REFERRAL / 100)).toFixed(2))
				return { ...item, lvl: '2 уровень' }
			})

		// Итоговые данные о начислении пользователей
		const history = [].concat(refferalUsersFirstLvlPaymentLog, refferalUsersSecondLvlPaymentLog)

		return res.status(200).send(history)
	} catch (error) {
		console.log(error)
		res.status(500).send(error)
	}
})

/*
 * Список "История выводов"
 */
router.get('/withdrawalOfMoney', verify.token, async (req, res) => {
	const skip = +req.query.skip || 0
	const limit = +(req.query.limit > 0 && req.query.limit <= 100 ? req.query.limit : 100)

	try {
		// Получение истории выводов
		const history = await ReferralWithdrawalLog.find(
			{ userId: req.user._id },
			{ _id: false, approverUserId: false, userId: false, __v: false, updatedAt: false }
		)
			.skip(skip)
			.limit(limit)
			.lean()
		return res.status(200).send(history)
	} catch (error) {
		return res.status(500).send(error)
	}
})

/*
 * Изменить данные карты
 */
router.patch('/changeCard', verify.token, async (req, res) => {
	let { number, cardholder } = req.body

	if (!number || !cardholder) {
		return resError({
			res,
			alert: true,
			msg: 'Недостаточно данных',
		})
	}

	number = number.toString()
	cardholder = cardholder.toString()

	if (number.length !== 16) {
		return resError({
			res,
			alert: true,
			msg: 'Недопустимая длина поля: Номер карты',
		})
	}

	if (cardholder.length > 150) {
		return resError({
			res,
			alert: true,
			msg: 'Превышена длина поля: ФИО',
		})
	}

	try {
		await User.updateOne(
			{ _id: req.user._id },
			{
				$set: {
					'referral.card': {
						number,
						cardholder,
					},
				},
			}
		)

		return resSuccess({
			res,
			alert: true,
			msg: 'Карта обновлена',
		})
	} catch (err) {
		return resError({ res, msg: err })
	}
})

/*
 * Удалить данные карты
 */
router.delete('/deleteCard', verify.token, async (req, res) => {
	try {
		await User.updateOne(
			{ _id: req.user._id },
			{
				$set: {
					'referral.card': null,
				},
			}
		)

		return resSuccess({
			res,
			alert: true,
			msg: 'Данные карты удалены',
		})
	} catch (err) {
		return resError({ res, msg: err })
	}
})

/*
 * Создание заявки на вывод c обнулением баланса
 */
router.post('/withdrawBalance', verify.token, async (req, res) => {
	const { card, balance } = req.user.referral

	if (!card || card.number?.length !== 16) {
		return resError({
			res,
			alert: true,
			msg: 'Требуется добавить карту',
		})
	}

	if (!balance || +balance <= 0) {
		return resError({
			res,
			alert: true,
			msg: 'Недостаточно средств для вывода',
		})
	}

	try {
		await new ReferralWithdrawalLog({
			userId: req.user._id,
			amount: +balance,
			card: req.user.referral.card,
			status: 'pending',
		}).save()

		await User.updateOne(
			{ _id: req.user._id },
			{
				$set: {
					'referral.balance': 0,
				},
			}
		)

		return resSuccess({
			res,
			alert: true,
			msg: 'Создана заявка на вывод средств',
		})
	} catch (err) {
		return resError({ res, msg: err })
	}
})

module.exports = router
