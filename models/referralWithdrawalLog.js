const mongoose = require('mongoose');

/*
 * Лог вывода баланса в реферальной программе
 */
const referralWithdrawalLogSchema = new mongoose.Schema({
	userId: mongoose.Schema.Types.ObjectId, // ID пользователя отправившего заявку
	approverUserId: mongoose.Schema.Types.ObjectId,  // ID сотрудника ответившего на заявку
	amount: Number, // Сумма вывода
	status: String, // Статус заявки
}, {
	timestamps: true
})

module.exports = mongoose.model('ReferralWithdrawalLog', referralWithdrawalLogSchema)