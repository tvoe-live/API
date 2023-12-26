const axios = require('axios')
const crypto = require('crypto')
const User = require('../models/user')
const PaymentLog = require('../models/paymentLog')
const { FIRST_STEP_REFERRAL, SECOND_STEP_REFERRAL } = require('../constants')
const { API_URL, PAYMENT_TERMINAL_KEY, PAYMENT_TERMINAL_PASSWORD } = process.env

/*
 * Функции для платежной системы
 */

/*
 * Формирование платежной информации терминала для банка
 */
const getTerminalParams = ({
	amount,
	orderId,
	tariffName,
	failURL = null,
	successURL = null,
	user = {
		_id: null,
		email: null,
		phone: null,
	},
}) => ({
	TerminalKey: PAYMENT_TERMINAL_KEY, // ID терминала
	Password: PAYMENT_TERMINAL_PASSWORD,

	SuccessURL: successURL, // URL успешной оплаты
	FailURL: failURL, // URL неуспешной оплаты
	NotificationURL: `${API_URL}/payment/notification`, // URL для уведомлений об оплате

	OrderId: orderId,
	Amount: amount * 100,
	Description: `Подписка на ${tariffName}`,
	Recurrent: 'Y', // Рекуррентный платеж
	CustomerKey: user._id, // Идентификатор клиента в системе Мерчанта
	PayType: 'O', // Тип проведения платежа ("O" - одностадийная оплата)
	Language: 'ru', // Язык платежной формы

	Receipt: {
		Items: [
			{
				Name: `Подписка на ${tariffName}`, // Наименование товара
				Price: amount * 100, // Цена в копейках
				Quantity: 1, // Количество или вес товара
				Amount: amount * 100, // Стоимость товара в копейках. Произведение Quantity и Price
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
})

/*
 * Получение токена для проверки подлинности запросов
 */
const getToken = (params) => {
	const concatStr = Object.keys(params) // Собрать массив передаваемых данных в виде пар Ключ-Значения
		.sort() // Отсортировать массив по алфавиту по ключу
		.map((key) => params[key] && params[key].toString().replace(/\s+/g, '')) // Привести все значения строку и удалить пробелы
		.join('') // Конкетировать каждое значение

	// Токен SHA-256 из конкетированных данных терминала
	const token = crypto.createHash('sha256').update(concatStr).digest('hex')

	return token
}

/*
 * Вернуть 1 рубль пользователю за оплату пробного тарифа
 */
const paymentCancelTrialTariff = async ({ paymentId }) => {
	if (!paymentId) return

	paymentId = String(paymentId)

	const cancelToken = getToken({
		TerminalKey: PAYMENT_TERMINAL_KEY,
		Password: PAYMENT_TERMINAL_PASSWORD,
		PaymentId: paymentId,
	})

	const { data } = await axios.post('https://securepay.tinkoff.ru/v2/Cancel', {
		TerminalKey: PAYMENT_TERMINAL_KEY,
		Password: PAYMENT_TERMINAL_PASSWORD,
		PaymentId: paymentId,
		Token: cancelToken,
	})

	// Обработка ошибки: Невозможно отменить транзакцию в статусе REFUNDED
	// Устанавливаем, что возврат уже произведен
	if (data.ErrorCode === '4') {
		await PaymentLog.updateOne(
			{ paymentId },
			{
				$set: {
					status: 'REFUNDED',
				},
			}
		)
	}
}

/*
 * Начисление реферерам доли с подписки пользователя
 */
const shareWithReferrer = async ({ userId, amount, refererUserId }) => {
	if (!userId || !refererUserId || !amount || amount === 1 || amount === -1) return

	// Начисление бонуса рефереру 1-го уровня
	const referalUser = await User.findByIdAndUpdate(refererUserId, {
		$inc: { 'referral.balance': amount * (FIRST_STEP_REFERRAL / 100) },
	})

	// Начисление бонуса рефереру 2-го уровня
	if (referalUser.refererUserId) {
		await User.updateOne(
			{ _id: referalUser.refererUserId },
			{ $inc: { 'referral.balance': amount * (SECOND_STEP_REFERRAL / 100) } }
		)
	}
}

module.exports = {
	getToken,
	getTerminalParams,
	shareWithReferrer,
	paymentCancelTrialTariff,
}
