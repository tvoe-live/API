const { default: axios } = require('axios')
const paymentLog = require('../models/paymentLog')
const repaymentModel = require('../models/repayment')

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
			'referral.balance': amount * (process.env.FIRST_STEP_REFERRAL / 100),
		},
	})

	if (referalUser.refererUserId) {
		await user.findByIdAndUpdate(referalUser.refererUserId, {
			$inc: {
				'referral.balance': amount * (process.env.SECOND_STEP_REFERRAL / 100),
			},
		})
	}
}

const repaymentTask = async () => {
	try {
		const repaymentData = await repaymentModel.find().populate('user').populate('tariff')
		for (item of repaymentData) {
			const userPaymentLog = await paymentLog.create({
				type: 'paid',
				userId: item.user._id,
				tariffId: item.tariff._id,
				isChecked: false,
			})

			const terminalParams = {
				TerminalKey: process.env.PAYMENT_TERMINAL_KEY,
				Password: process.env.PAYMENT_TERMINAL_PASSWORD,
				Amount: item.tariff.price * 100,
				OrderId: userPaymentLog._id,
				Description: `Подписка на ${userTariff.name}`,
				PayType: 'O',
				Language: 'ru',
				Receipt: {
					Items: [
						{
							Name: `Подписка на ${item.tariff.name}`, // Наименование товара
							Price: item.tariff.price * 100, // Цена в копейках
							Quantity: 1, // Количество или вес товара
							Amount: item.tariff.price * 100, // Стоимость товара в копейках. Произведение Quantity и Price
							PaymentMethod: 'lfull_prepayment', // Признак способа расчёта (предоплата 100%)
							PaymentObject: 'commodity', // Признак предмета расчёта (товар)
							Tax: 'vat20', // Ставка НДС (ставка 20%)
						},
					],
					FfdVersion: '1.05',
					Taxation: 'usn_income',
					Email: user.email || 'support@tvoe.team',
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

			const { data: chargePayment } = await axios.post('https://securepay.tinkoff.ru/v2/Charge', {
				TerminalKey: process.env.PAYMENT_TERMINAL_KEY,
				PaymentId: initPayment.PaymentId,
				RebillId: item.user.RebillId,
				Token: token,
			})

			if (chargePayment.Status === 'REJECTED') {
				if (chargePayment.ErrorCode === '10') {
					console.log('Невозможна реализация автоплатежей')
				}

				if (chargePayment.ErrorCode === '103') {
					await notification.create({
						receiversIds: [item.user._id],
						title: 'Недостаточно средств на счете для продления подписки',
						willPublishedAt: Date.now(),
						type: 'PROFILE',
						deleted: false,
					})

					item.count++
					if (item.count === 3) {
						await repaymentModel.findByIdAndDelete(item._id)
					}
				}

				if (chargePayment.ErrorCode === '116') {
					await notification.create({
						receiversIds: [item.user._id],
						title: 'Недостаточно средств на карте для продления подписки',
						willPublishedAt: Date.now(),
						type: 'PROFILE',
						deleted: false,
					})

					item.count++
					if (item.count === 3) {
						await repaymentModel.findByIdAndDelete(item._id)
					}
				}
			}

			if (chargePayment.Status === 'CONFIRMED') {
				user.subscribe = {
					startAt: new Date(),
					finishAt: new Date() + userTariff.duration,
					tariffId: userTariff._id,
				}

				await user.save()

				await shareWithReferrer(item.user._id, item.tariff.price, user.refererUserId)

				await notification.create({
					receiversIds: [item.user._id],
					title: 'Подписка продлена',
					willPublishedAt: Date.now(),
					type: 'PROFILE',
					deleted: false,
				})

				await repaymentModel.findByIdAndDelete(item._id)
			}
		}
	} catch (error) {
		console.log(error)
	}
}

module.exports = repaymentTask
