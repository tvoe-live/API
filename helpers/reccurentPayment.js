const crypto = require('crypto')
const user = require('../models/user')
const tariff = require('../models/tariff')
const { default: axios } = require('axios')
const paymentLog = require('../models/paymentLog')
const notification = require('../models/notification')
const repaymentModel = require('../models/repayment')
const { FIRST_STEP_REFERRAL, SECOND_STEP_REFERRAL } = require('../constants')

const getToken = (params) => {
	const concatStr = Object.keys(params) // Собрать массив передаваемых данных в виде пар Ключ-Значения
		.sort() // Отсортировать массив по алфавиту по ключу
		.map(
			(
				key // Привести все значения строку и удалить пробелы
			) => params[key].toString().replace(/\s+/g, '')
		)
		.join('') // Конкетировать каждое значение

	// Токен SHA-256 из конкетированных данных терминала
	const token = crypto.createHash('sha256').update(concatStr).digest('hex')

	return token
}

const shareWithReferrer = async (userId, amount, refererUserId) => {
	if (!userId || !amount || !refererUserId) return

	const referalUser = await user.findByIdAndUpdate(refererUserId, {
		$inc: {
			'referral.balance': amount * (FIRST_STEP_REFERRAL / 100),
		},
	})

	if (referalUser.refererUserId) {
		await user.findByIdAndUpdate(referalUser.refererUserId, {
			$inc: {
				'referral.balance': amount * (SECOND_STEP_REFERRAL / 100),
			},
		})
	}
}

const recurrentPayment = async () => {
	try {
		const start = new Date()
		const finish = new Date(start - 3600000)

		const users = await user.find(
			{
				'subscribe.finishAt': { $lt: start, $gte: finish },
				RebillId: { $exists: true },
				autoPayment: true,
			},
			{ _id: true, subscribe: true, RebillId: true }
		)

		for (const user of users) {
			const userTariff = await tariff.findById(user.subscribe.tariffId)
			const userPaymentLog = await paymentLog.create({
				type: 'paid',
				userId: user._id,
				tariffId: userTariff._id,
				isChecked: false,
				isReccurent: true,
			})

			const terminalParams = {
				TerminalKey: process.env.PAYMENT_TERMINAL_KEY,
				Password: process.env.PAYMENT_TERMINAL_PASSWORD,
				Amount: userTariff.price * 100,
				OrderId: userPaymentLog._id,
				Description: `Подписка на ${userTariff.name}`,
				PayType: 'O',
				Language: 'ru',
				Receipt: {
					Items: [
						{
							Name: `Подписка на ${userTariff.name}`, // Наименование товара
							Price: userTariff.price * 100, // Цена в копейках
							Quantity: 1, // Количество или вес товара
							Amount: userTariff.price * 100, // Стоимость товара в копейках. Произведение Quantity и Price
							PaymentMethod: 'lfull_prepayment', // Признак способа расчёта (предоплата 100%)
							PaymentObject: 'commodity', // Признак предмета расчёта (товар)
							Tax: 'none', // Ставка без НДС
						},
					],
					FfdVersion: '1.05',
					Taxation: 'usn_income',
					Email: user.email || 'no-relpy@tvoe.team',
					Phone: user.phone || '+74956635979',
				},
			}

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
				Password: process.env.PAYMENT_TERMINAL_PASSWORD,
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
					await repaymentModel.create({
						tariff: userTariff._id,
						user: user._id,
					})

					await notification.create({
						receiversIds: [user._id],
						title: 'Недостаточно средств на счете для продления подписки',
						willPublishedAt: Date.now(),
						type: 'PROFILE',
						deleted: false,
					})

					userPaymentLog.isChecked = true
					userPaymentLog.status = chargePayment.Status
					userPaymentLog.success = chargePayment.Success
					userPaymentLog.errorCode = chargePayment.ErrorCode
					userPaymentLog.orderId = chargePayment.OrderId
					userPaymentLog.terminalKey = process.env.PAYMENT_TERMINAL_KEY
					userPaymentLog.rebillId = user.RebillId
					userPaymentLog.refundedAmount = 0
					userPaymentLog.message = chargePayment.Message
					userPaymentLog.details = chargePayment.Details
					userPaymentLog.token = chargeToken
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

					userPaymentLog.isChecked = true
					userPaymentLog.status = chargePayment.Status
					userPaymentLog.success = chargePayment.Success
					userPaymentLog.errorCode = chargePayment.ErrorCode
					userPaymentLog.orderId = chargePayment.OrderId
					userPaymentLog.terminalKey = process.env.PAYMENT_TERMINAL_KEY
					userPaymentLog.rebillId = user.RebillId
					userPaymentLog.refundedAmount = 0
					userPaymentLog.message = chargePayment.Message
					userPaymentLog.details = chargePayment.Details
					userPaymentLog.token = chargeToken

					await userPaymentLog.save()

					await repaymentModel.create({
						tariff: userTariff._id,
						user: user._id,
					})
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

				userPaymentLog.isChecked = true
				userPaymentLog.status = chargePayment.Status
				userPaymentLog.success = chargePayment.Success
				userPaymentLog.errorCode = chargePayment.ErrorCode
				userPaymentLog.orderId = chargePayment.OrderId
				userPaymentLog.terminalKey = process.env.PAYMENT_TERMINAL_KEY
				userPaymentLog.rebillId = user.RebillId
				userPaymentLog.startAt = startAt
				userPaymentLog.finishAt = new Date(startAt.getTime() + Number(userTariff.duration))
				userPaymentLog.refundedAmount = 0
				userPaymentLog.message = chargePayment.Message
				userPaymentLog.details = chargePayment.Details
				userPaymentLog.amount = userTariff.price
				userPaymentLog.sum = userTariff.price
				userPaymentLog.token = chargeToken

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
