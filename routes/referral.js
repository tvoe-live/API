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

// Дата введения 2-уровневой реферальной программы
const secondLvlDateRelease = new Date('2023-11-24')

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
	let firstLvlReferrals = 0 // Реферальные пользователи 1-го уровня
	let secondLvlReferrals = 0 // Реферальные пользователи 2-го уровня
	let authCount = 0 // Общее количество реферальных пользователей

	try {
		if (authedUser && req.user.referral) {
			// ID реф. пользователей всех уровней
			const commonUserIds = [...req.user.referral.userIds]

			// Получение реф. пользователей 1-го уровня
			const referralUsersFirstLvl = commonUserIds.length
				? await User.find(
						{ _id: { $in: req.user.referral.userIds } },
						{ _id: true, referral: true }
				  ).lean()
				: []

			const secondUserIds = [] // ID пользователей 2-го уровня

			referralUsersFirstLvl.forEach((referralUser) => {
				if (!referralUser.referral) return

				secondUserIds.push(...referralUser.referral.userIds)
				commonUserIds.push(...referralUser.referral.userIds)
			})

			// Логи всех платежей реф. пользователей всех уровней
			const paymentLogs = commonUserIds.length
				? await PaymentLog.find(
						{
							userId: { $in: commonUserIds },
							status: { $in: ['success', 'CONFIRMED', 'AUTHORIZED'] },
							amount: { $ne: null },
							type: 'paid',
						},
						{
							_id: false,
							userId: true,
							tariffId: true,
							amount: true,
							status: true,
							createdAt: true,
						}
				  )
				: []

			// Пробегаем по массивам с пользователями и считаем количество пользователей, проводивших оплаты
			req.user.referral.userIds.forEach((userId) => {
				const paymentLog = paymentLogs.find((l) => userId.toString() === l.userId.toString())
				if (paymentLog) firstLvlReferrals++
			})
			secondUserIds.forEach((userId) => {
				const paymentLog = paymentLogs.find((l) => userId.toString() === l.userId.toString())
				if (!paymentLog || paymentLog.createdAt < secondLvlDateRelease) return
				firstLvlReferrals++
			})

			authCount = commonUserIds.length
			console.log(commonUserIds)
		}

		return resSuccess({
			res,
			authedUser,
			link,
			card,
			balance,
			firstLvlReferrals,
			secondLvlReferrals,
			authCount,
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
		// ID реф. пользователей всех уровней
		const commonUserIds = [...req.user.referral.userIds]

		// Получение реф. пользователей 1-го уровня
		const referralUsersFirstLvl = commonUserIds.length
			? await User.find(
					{ _id: { $in: commonUserIds } },
					{ _id: true, firstname: true, avatar: true, referral: true }
			  ).lean()
			: []

		const secondUserIds = [] // ID реф. пользователей 2-го уровня

		referralUsersFirstLvl.forEach((referralUser) => {
			if (!referralUser.referral) return

			secondUserIds.push(...referralUser.referral.userIds)
			commonUserIds.push(...referralUser.referral.userIds)
		})

		// Получение реф. пользователей 2-го уровня
		const referralUsersSecondLvl = secondUserIds.length
			? await User.find(
					{ _id: { $in: secondUserIds } },
					{ _id: true, firstname: true, avatar: true }
			  ).lean()
			: []

		// Логи всех платежей реф. пользователей всех уровней
		const paymentLogs = commonUserIds.length
			? await PaymentLog.find(
					{
						userId: { $in: commonUserIds },
						status: { $in: ['success', 'CONFIRMED', 'AUTHORIZED'] },
						amount: { $ne: null },
						type: 'paid',
					},
					{
						_id: false,
						userId: true,
						tariffId: true,
						amount: true,
						status: true,
						createdAt: true,
					}
			  )
			: []

		// История платежей
		const items = []

		// Пробегаем по массиву с логами и формируем из него результат вместе с данными профиля
		paymentLogs.forEach((paymentLog) => {
			const condition = (referralUser) =>
				referralUser._id.toString() === paymentLog.userId.toString()

			const firstLvlUser = referralUsersFirstLvl.find(condition)
			const secondLvlUser = !firstLvlUser && referralUsersSecondLvl.find(condition)

			// Если это пользователь 2-го уровня и лог был создан позже даты введения 2-го уровня, то выходим
			if (secondLvlUser && paymentLog.createdAt < secondLvlDateRelease) return

			items.push({
				payment: {
					createdAt: paymentLog.createdAt,
					status: paymentLog.status,
					bonuseAmount: Number(
						(
							paymentLog.amount *
							((firstLvlUser ? FIRST_STEP_REFERRAL : SECOND_STEP_REFERRAL) / 100)
						).toFixed(2)
					),
					tariffName: paymentLog.tariffId, // Нужно tariffName
					level: firstLvlUser ? '1 уровень' : '2 уровень',
				},
				user: {
					avatar: (firstLvlUser || secondLvlUser).avatar,
					firstname: (firstLvlUser || secondLvlUser).firstname,
				},
			})
		})

		return resSuccess({ res, items, totalSize: items.length })
	} catch (err) {
		return resError({ res, msg: err })
	}
})

/*
 * Список "История выводов"
 */
router.get('/withdrawalOfMoney', verify.token, async (req, res) => {
	const skip = +req.query.skip || 0
	const limit = +(req.query.limit > 0 && req.query.limit <= 100 ? req.query.limit : 100)

	try {
		const result = await ReferralWithdrawalLog.aggregate([
			{
				$facet: {
					// Всего записей
					totalSize: [
						{
							$match: {
								userId: req.user._id,
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
								userId: req.user._id,
							},
						},
						{
							$project: {
								_id: false,
								amount: true,
								createdAt: true,
								card: {
									number: {
										$concat: ['**** **** **** ', { $substrBytes: ['$card.number', 12, 16] }],
									},
								},
								status: true,
							},
						},
						{ $sort: { createdAt: -1 } },
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

		return resSuccess({ res, ...result[0] })
	} catch (err) {
		return resError({ res, msg: err })
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
