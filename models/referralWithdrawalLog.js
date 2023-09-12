const mongoose = require("mongoose");

/*
 * Лог вывода баланса в реферальной программе
 */

const referralWithdrawalLogSchema = new mongoose.Schema(
	{
		userId: mongoose.Schema.Types.ObjectId, // ID пользователя отправившего заявку
		approverUserId: mongoose.Schema.Types.ObjectId, // ID сотрудника ответившего на заявку
		amount: Number, // Сумма вывода
		card: {
			// Данные карты для вывода баланса
			number: String, // Номер карты
			cardholder: String, // Владелец карты
		},
		status: String, // Статус заявки | canceled - отказ, pending - в процессе, success - успешно
	},
	{
		timestamps: true,
	},
);

module.exports = mongoose.model("ReferralWithdrawalLog", referralWithdrawalLogSchema);
