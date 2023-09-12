const mongoose = require("mongoose");

/*
 * Журнал всех операций с платежной системой
 */

const paymentLogSchema = new mongoose.Schema(
	{
		// Данные от нашего API
		userId: mongoose.Schema.Types.ObjectId, // ID пользователя
		tariffId: mongoose.Schema.Types.ObjectId, // ID тарифа
		type: {
			// Тип платежного лога
			type: String,
			enum: [
				"trial", // Пробная подписка
				"paid", // Оплачен пользователем
				"issued-by-admin", // Выдан администратором
			],
		},
		startAt: Date, // Дата начала действия тарифа
		finishAt: Date, // Дата конца действия тарифа

		// Данные от Тинькофф Кассы
		terminalKey: String, // Идентификатор терминала. Выдается Мерчанту Тинькофф Кассой при заведении терминала.
		amount: Number, // Сумма пополнения
		refundedAmount: Number, // Сумма возврата или частичного возврата
		orderId: mongoose.Schema.Types.ObjectId, // Идентификатор заказа в системе Мерчанта
		success: Boolean, // Выполнение платежа
		status: {
			// Статус платежа
			type: String,
			enum: [
				"AUTHORIZED", // Деньги захолдированы на карте клиента. Ожидается подтверждение операции
				"CONFIRMED", // Операция подтверждена
				"PARTIAL_REVERSED", // Частичная отмена
				"REVERSED", // Операция отменена
				"PARTIAL_REFUNDED", // Произведён частичный возврат
				"REFUNDED", // Произведён возврат
				"REJECTED", // Списание денежных средств закончилась ошибкой
				"3DS_CHECKING", // Автоматическое закрытие сессии, которая превысила срок пребывания в статусе 3DS_CHECKING (более 36 часов)
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
	},
);

module.exports = mongoose.model("PaymentLog", paymentLogSchema);
