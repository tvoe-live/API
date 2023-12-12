const { API_URL, PAYMENT_TERMINAL_KEY, PAYMENT_TERMINAL_PASSWORD } = process.env
const { FIRST_STEP_REFERRAL, SECOND_STEP_REFERRAL } = require('../constants')
const crypto = require('crypto')
const User = require('../models/user')

/*
 * Функции для платежной системы
 */

const getTerminalParams = ({
	amount,
	orderId,
	tariffName,
	failURL = null,
	successURL = null,
	userId = null,
	userEmail = null,
	userPhone = null,
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
	CustomerKey: userId, // Идентификатор клиента в системе Мерчанта
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
		Email: userEmail || 'no-relpy@tvoe.team',
		Phone: userPhone || '+74956635979',
	},
})

/*
 * Получение токена для проверки подлинности запросов
 */
const getToken = (params) => {
	const concatStr = Object.keys(params) // Собрать массив передаваемых данных в виде пар Ключ-Значения
		.sort() // Отсортировать массив по алфавиту по ключу
		.map((key) => params[key].toString().replace(/\s+/g, '')) // Привести все значения строку и удалить пробелы
		.join('') // Конкетировать каждое значение

	// Токен SHA-256 из конкетированных данных терминала
	const token = crypto.createHash('sha256').update(concatStr).digest('hex')

	return token
}

/*
 * Начисление рефереру долю с подписки пользователя
 */
const shareWithReferrer = async (userId, amount, refererUserId) => {
	if (!userId || !amount || !refererUserId) return

	const referalUser = await User.findByIdAndUpdate(refererUserId, {
		$inc: {
			'referral.balance': amount * (FIRST_STEP_REFERRAL / 100),
		},
	})

	if (referalUser.refererUserId) {
		await User.findByIdAndUpdate(referalUser.refererUserId, {
			$inc: {
				'referral.balance': amount * (SECOND_STEP_REFERRAL / 100),
			},
		})
	}
}

module.exports = {
	getToken,
	getTerminalParams,
	shareWithReferrer,
}
