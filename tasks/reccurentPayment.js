const User = require('../models/user')
const tariff = require('../models/tariff')
const { default: axios } = require('axios')
const paymentLog = require('../models/paymentLog')
const notification = require('../models/notification')
const { getToken, getTerminalParams, shareWithReferrer } = require('../helpers/payment')

const recurrentPayment = async () => {
	try {
		// Запуск за 15 минут до завершения подписки
		const start = new Date()
		const finish = new Date(start - 60 * 1000)

		// Снять подписки у кого нет автосписания сутки назад
		const finishDay = new Date(start - 86400 * 1000)

		// Выборка всех пользователей, которые скоро завершат подписку
		const users = await User.find(
			{ 'subscribe.finishAt': { $exists: true, $lte: finish } },
			{
				_id: true,
				rebillId: true,
				subscribe: true,
				autoPayment: true,
			}
		)

		// Завершить, если нет пользователей для выполнения платежей
		if (!users.length) return

		// Получение пробного тарифа
		const trialTariff = await tariff.findOne({ price: 1 }, { _id: true }).lean()
		// Получение месячного тарифа
		const monthTariff = await tariff
			.findOne({ autoEnableAfterTrialTariff: true }, { _id: true })
			.lean()

		for (const user of users) {
			console.log(user)

			// Если пользователь отключил автопродление, снять подписку
			if (
				!user.autoPayment ||
				!user.subscribe.tariffId ||
				!user.rebillId ||
				(!user.autoPayment && user.subscribe.finishAt < finishDay)
			) {
				user.subscribe = null
				await user.save()

				continue
			}

			// Если пользователь взял пробный тариф, то перевести на месячный тариф
			const userSubscribeTariffId =
				user.subscribe.tariffId.toString() === trialTariff._id.toString()
					? monthTariff._id
					: user.subscribe.tariffId

			// Поиск информации о тарифе пользователя
			const userTariff = await tariff.findById(userSubscribeTariffId, {
				_id: true,
				name: true,
				price: true,
				duration: true,
			})

			// Создание платежного лога
			const userPaymentLog = await paymentLog.create({
				type: 'paid',
				userId: user._id,
				isChecked: false,
				isReccurent: true,
				amount: userTariff.price,
				tariffId: userTariff._id,
				tariffPrice: userTariff.price,
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
				Password: process.env.PAYMENT_TERMINAL_PASSWORD,
				PaymentId: String(initPayment.PaymentId),
				RebillId: user.rebillId,
			})

			const { data: chargePayment } = await axios.post('https://securepay.tinkoff.ru/v2/Charge', {
				TerminalKey: process.env.PAYMENT_TERMINAL_KEY,
				PaymentId: initPayment.PaymentId,
				RebillId: user.rebillId,
				Password: process.env.PAYMENT_TERMINAL_PASSWORD,
				Token: chargeToken,
			})

			if (chargePayment.Status === 'REJECTED' || +chargePayment.ErrorCode > 0) {
				user.subscribe = null
				await user.save()

				if (chargePayment.ErrorCode === '10') {
					console.log('Невозможна реализация автоплатежей')
					continue
				}

				if (chargePayment.ErrorCode === '103' || chargePayment.ErrorCode === '116') {
					await notification.create({
						receiversIds: [user._id],
						title: 'Недостаточно средств на карте для продления подписки',
						willPublishedAt: Date.now(),
						type: 'PROFILE',
						deleted: false,
					})

					userPaymentLog.rebillId = user.rebillId
					userPaymentLog.status = chargePayment.Status
					userPaymentLog.success = chargePayment.Success
					userPaymentLog.errorCode = chargePayment.ErrorCode
					userPaymentLog.orderId = chargePayment.OrderId
					userPaymentLog.message = chargePayment.Message
					userPaymentLog.details = chargePayment.Details
					userPaymentLog.terminalKey = process.env.PAYMENT_TERMINAL_KEY

					await userPaymentLog.save()
					continue
				} else {
					await notification.create({
						receiversIds: [user._id],
						title: 'Платеж отклонен',
						description: chargePayment.Message,
						willPublishedAt: Date.now(),
						type: 'PROFILE',
						deleted: false,
					})
				}
			}

			if (chargePayment.Status === 'AUTHORIZED' || chargePayment.Status === 'CONFIRMED') {
				const startAt = user.subscribe.finishAt
				const finishAt = new Date(user.subscribe.finishAt.getTime() + +userTariff.duration)

				console.log(startAt, finishAt, +userTariff.duration)

				user.subscribe = {
					startAt,
					finishAt,
					tariffId: userTariff._id,
				}

				await user.save()

				await shareWithReferrer({
					userId: user._id,
					amount: userTariff.price,
					refererUserId: user.refererUserId,
				})

				userPaymentLog.status = chargePayment.Status
				userPaymentLog.success = chargePayment.Success
				userPaymentLog.errorCode = chargePayment.ErrorCode
				userPaymentLog.orderId = chargePayment.OrderId
				userPaymentLog.terminalKey = process.env.PAYMENT_TERMINAL_KEY
				userPaymentLog.rebillId = user.rebillId
				userPaymentLog.startAt = startAt
				userPaymentLog.finishAt = finishAt
				userPaymentLog.message = chargePayment.Message
				userPaymentLog.details = chargePayment.Details
				userPaymentLog.amount = userTariff.price
				userPaymentLog.sum = userTariff.price

				await userPaymentLog.save()

				const addZero = (date) => ('0' + date.toString()).slice(-2)

				const finishAtFormatted = `${addZero(finishAt.getDate())}.${addZero(
					finishAt.getMonth() + 1
				)}.${finishAt.getFullYear()}`

				await notification.create({
					receiversIds: [user._id],
					title: 'Подписка продлена до ' + finishAtFormatted,
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
