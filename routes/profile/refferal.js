const { Router } = require('express')
const user = require('../../models/user')
const paymentLog = require('../../models/paymentLog')
const referralWithdrawalLog = require('../../models/referralWithdrawalLog')
const verify = require('../../middlewares/verify')

/**
 * Роут для получения истории начисления бонусов с реф.системы, истории выводов и статистики
 */
const refferalRouter = Router()

/**
 * Получение статистики по реф.системе
 */
refferalRouter.get('/stat', verify.token, async (req, res) => {
	try {
		// Получаем данные пользователя по реферальной программе и данные его реф.ссылки
		const mainUser = await user.findById(req.user._id, { referral: true }).lean()

		// Получаем реф.пользователей 1го уровня
		const refferalUsersFirstLvl = await user
			.find({ _id: { $in: mainUser.referral.userIds } }, { _id: true, referral: true })
			.lean()

		// Получение ползователей 2го уровня
		const referalUsersSecondLvlPromises = refferalUsersFirstLvl.map((usr) =>
			user.find({ _id: { $in: usr.referral.userIds } }, { _id: true }).lean()
		)
		const refferalUsersSecondLvl = (await Promise.all(referalUsersSecondLvlPromises)).reduce(
			(acc, item) => acc.concat(item),
			[]
		)

		return res.status(200).send({
			balance: mainUser.referral.balance,
			firstLvlReferrals: refferalUsersFirstLvl.length,
			secondLvlReferrals: refferalUsersSecondLvl.length,
			authCount: refferalUsersFirstLvl.length + refferalUsersSecondLvl.length,
		})
	} catch (error) {
		console.log(error)
		return res.status(500).send(error)
	}
})

/**
 * Получение истории вывода средств
 */
refferalRouter.get('/withdrawal', verify.token, async (req, res) => {
	try {
		// Получение истории выводов
		const history = await referralWithdrawalLog
			.find(
				{ userId: req.user._id },
				{ _id: false, approverUserId: false, userId: false, __v: false, updatedAt: false }
			)
			.lean()
		return res.status(200).send(history)
	} catch (error) {
		return res.status(500).send(error)
	}
})

/**
 * Получение истории начисления бонусов
 */
refferalRouter.get('/', verify.token, async (req, res) => {
	try {
		// Получение данных пользователя
		const mainUser = await user.findById(req.user._id, { _id: true, referral: true }).lean()

		// Получение данных реф.пользователей 1го уровня
		const refferalUsersFirstLvl = await user.find(
			{ _id: { $in: mainUser.referral.userIds } },
			{ _id: true, referral: true }
		)

		// Получение данных об оплате тарифов реф.пользователей 1го уровня
		const refferalUsersFirstLvlPaymentLogPromises = refferalUsersFirstLvl.map((usr) =>
			paymentLog
				.find(
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
				item.amount = Number((item.amount * (process.env.FIRST_STEP_REFFERAL / 100)).toFixed(2))
				return { ...item, lvl: '1 уровень' }
			})

		// Получение данных реф.пользователей 2го уровня
		const referalUsersSecondLvlPromises = refferalUsersFirstLvl.map((usr) =>
			user.find(
				{
					$and: [{ _id: { $in: usr.referral.userIds } }, { _id: { $not: { $eq: mainUser._id } } }],
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
			paymentLog
				.find(
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
				item.amount = Number((item.amount * (process.env.SECOND_STEP_REFFERAL / 100)).toFixed(2))
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

module.exports = refferalRouter
