const user = require('../models/user')
const tariff = require('../models/tariff')
const { default: axios } = require('axios')
const paymentLog = require('../models/paymentLog')
const notification = require('../models/notification')
const { getToken, getTerminalParams, shareWithReferrer } = require('../helpers/payment')

const recurrentPayment = async () => {
	try {
		// Запуск за 15 минут до завершения подписки
		const start = new Date()
		const finish = new Date(start - 900 * 1000)

		// Выборка всех пользователей, которые скоро завершат подписку
		const users = await user.find(
			{
				autoPayment: true,
				RebillId: { $exists: true },
				'subscribe.finishAt': { $lt: start, $gte: finish },
			},
			{
				_id: true,
				RebillId: true,
				subscribe: true,
			}
		)

		// Завершить, если нет пользователей для выполнения платежей
		if (!users.length) return

		// Получение пробного тарифа
		const trialTariff = await tariff.findOne({ price: 1 }).lean()
		// Получение месячного тарифа
		const monthTariff = await tariff.findOne({ autoEnableAfterTrialTariff: true }).lean()

		for (const user of users) {
			// Если пользователь взял пробный тариф, то перевести на месячный тариф
			const userSubscribeTariffId =
				user.subscribe.tariffId === trialTariff._id ? monthTariff._id : user.subscribe.tariffId

			// Поиск информации о тарифе пользователя
			const userTariff = await tariff.findById(userSubscribeTariffId)

			const userPaymentLog = await paymentLog.create({
				type: 'paid',
				userId: user._id,
				isChecked: false,
				isReccurent: true,
				amount: userTariff.price,
				tariffId: userTariff._id,
				tariffPrice: userTariff._id,
			})

			// Получить параметры терминала
			const terminalParams = getTerminalParams({
				amount: userTariff.price,
				orderId: userPaymentLog._id,
				tariffName: userTariff.name,
				userEmail: user.email,
				userPhone: user.phone,
			})

			const token = getToken(terminalParams)

			const { data: initPayment } = await axios.post(
				'https://securepay.tinkoff.ru/v2/Init',
				{
					...terminalParams,
					Token: token,
				},
				{ headers: { 'Content-Type': 'application/json' } }
			)

			const chargeToken = getToken({
				TerminalKey: process.env.PAYMENT_TERMINAL_KEY,
				PaymentId: String(initPayment.PaymentId),
				//Password: process.env.PAYMENT_TERMINAL_PASSWORD,
				RebillId: user.RebillId,
			})

			const { data: chargePayment } = await axios.post('https://securepay.tinkoff.ru/v2/Charge', {
				TerminalKey: process.env.PAYMENT_TERMINAL_KEY,
				PaymentId: initPayment.PaymentId,
				RebillId: user.RebillId,
				Password: process.env.PAYMENT_TERMINAL_PASSWORD,
				Token: chargeToken,
			})

			if (chargePayment.Status === 'REJECTED') {
				if (chargePayment.ErrorCode === '10') {
					console.log('Невозможна реализация автоплатежей')
				}

				if (chargePayment.ErrorCode === '103') {
					await notification.create({
						receiversIds: [user._id],
						title: 'Недостаточно средств на счете для продления подписки',
						willPublishedAt: Date.now(),
						type: 'PROFILE',
						deleted: false,
					})

					//userPaymentLog.isChecked = true
					userPaymentLog.status = chargePayment.Status
					userPaymentLog.success = chargePayment.Success
					userPaymentLog.errorCode = chargePayment.ErrorCode
					userPaymentLog.orderId = chargePayment.OrderId
					userPaymentLog.terminalKey = process.env.PAYMENT_TERMINAL_KEY
					userPaymentLog.rebillId = user.RebillId
					//userPaymentLog.refundedAmount = 0
					userPaymentLog.message = chargePayment.Message
					userPaymentLog.details = chargePayment.Details
					//userPaymentLog.token = chargeToken
					await userPaymentLog.save()
				}

				if (chargePayment.ErrorCode === '116') {
					await notification.create({
						receiversIds: [user._id],
						title: 'Недостаточно средств на карте для продления подписки',
						willPublishedAt: Date.now(),
						type: 'PROFILE',
						deleted: false,
					})

					//userPaymentLog.isChecked = true
					userPaymentLog.status = chargePayment.Status
					userPaymentLog.success = chargePayment.Success
					userPaymentLog.errorCode = chargePayment.ErrorCode
					userPaymentLog.orderId = chargePayment.OrderId
					userPaymentLog.terminalKey = process.env.PAYMENT_TERMINAL_KEY
					userPaymentLog.rebillId = user.RebillId
					//userPaymentLog.refundedAmount = 0
					userPaymentLog.message = chargePayment.Message
					userPaymentLog.details = chargePayment.Details
					//userPaymentLog.token = chargeToken

					await userPaymentLog.save()
				}
			}

			if (chargePayment.Status === 'CONFIRMED') {
				const startAt = start

				user.subscribe = {
					startAt,
					finishAt: new Date(startAt.getTime() + Number(userTariff.duration)),
					tariffId: userTariff._id,
				}

				await user.save()

				await shareWithReferrer(user._id, userTariff.price, user.refererUserId)

				//userPaymentLog.isChecked = true
				userPaymentLog.status = chargePayment.Status
				userPaymentLog.success = chargePayment.Success
				userPaymentLog.errorCode = chargePayment.ErrorCode
				userPaymentLog.orderId = chargePayment.OrderId
				userPaymentLog.terminalKey = process.env.PAYMENT_TERMINAL_KEY
				userPaymentLog.rebillId = user.RebillId
				userPaymentLog.startAt = startAt
				userPaymentLog.finishAt = new Date(startAt.getTime() + Number(userTariff.duration))
				//userPaymentLog.refundedAmount = 0
				userPaymentLog.message = chargePayment.Message
				userPaymentLog.details = chargePayment.Details
				userPaymentLog.amount = userTariff.price
				userPaymentLog.sum = userTariff.price
				//userPaymentLog.token = chargeToken

				await userPaymentLog.save()

				await notification.create({
					receiversIds: [user._id],
					title: 'Подписка продлена',
					willPublishedAt: Date.now(),
					type: 'PROFILE',
					deleted: false,
				})
			}
		}
	} catch (error) {
		console.log(error)
	}
}

module.exports = recurrentPayment
