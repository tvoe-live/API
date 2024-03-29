const mongoose = require('mongoose')

/*
 * Журнал всех операций с платежной системой
 */

const paymentLogSchema = new mongoose.Schema(
	{
		// Данные от нашего API
		userId: {
			type: mongoose.Schema.Types.ObjectId,
			ref: 'User',
		}, // ID пользователя
		tariffId: {
			type: mongoose.Schema.Types.ObjectId,
			ref: 'Tariff',
		}, // ID тарифа
		promocodeId: mongoose.Schema.Types.ObjectId, // ID промокода, если оплата была совершена с учетом скидки от промокода. В противном случае это поле null
		type: {
			// Тип платежного лога
			type: String,
			enum: [
				'trial', // Пробная подписка
				'paid', // Оплачен пользователем
				'issued-by-admin', // Выдан администратором
			],
		},
		startAt: Date, // Дата начала действия тарифа
		finishAt: Date, // Дата конца действия тарифа
		isChecked: Boolean, // Проверен ли пользователем статус подписки
		countAttemptsRefunded: Number, // Количество попыток возврата
		countAttemptsAutopayments: Number, // Количество попыток автосписания

		// Данные от Тинькофф Кассы
		terminalKey: String, // Идентификатор терминала. Выдается Мерчанту Тинькофф Кассой при заведении терминала.
		amount: Number, // Сумма пополнения
		tariffPrice: Number, // Цена тарифа
		refundedAmount: Number, // Сумма возврата или частичного возврата
		orderId: mongoose.Schema.Types.ObjectId, // Идентификатор заказа в системе Мерчанта
		success: Boolean, // Выполнение платежа
		isReccurent: {
			// Рекуррентный ли платеж
			type: Boolean,
			default: false,
		},
		status: {
			// Статус платежа
			type: String,
			enum: [
				'AUTHORIZED', // Операция подтверждена. Деньги захолдированы на карте клиента. Ожидается подтверждение операции
				'CONFIRMED', // Операция подтверждена
				'PARTIAL_REVERSED', // Частичная отмена
				'REVERSED', // Операция отменена
				'PARTIAL_REFUNDED', // Произведён частичный возврат
				'REFUNDED', // Произведён полный возврат
				'REJECTED', // Списание денежных средств закончилась ошибкой
				'3DS_CHECKING', // Автоматическое закрытие сессии, которая превысила срок пребывания в статусе 3DS_CHECKING (более 36 часов)
			],
		},
		paymentId: String, // Уникальный идентификатор транзакции в системе Тинькофф Кассы
		errorCode: String, // Код ошибки. «0» в случае успеха
		message: String, // Краткое описание ошибки
		details: String, // Подробное описание ошибки
		rebillId: String, // Идентификатор автоплатежа
		cardId: Number, // Идентификатор карты в системе Тинькофф Кассы
		pan: String, // Замаскированный номер карты/Замаскированный номер телефона
		expDate: String, // Срок действия карты В формате MMYY, где YY — две последние цифры года
		token: String, // Токен для проверки подлинности запроса (удаляется после успешной операции)
	},
	{
		timestamps: true,
	}
)

module.exports = mongoose.model('PaymentLog', paymentLogSchema)
