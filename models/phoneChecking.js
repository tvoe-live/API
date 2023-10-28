const mongoose = require('mongoose')

/*
 * Журнал подтверждений телефонов через смс
 */

const phoneCheckingSchema = new mongoose.Schema(
	{
		phone: {
			// Номер телефона
			type: Number,
			index: true,
		},
		code: Number, // 4 значный код подтверждения
		attemptAmount: Number, // Число попыток
		isConfirmed: Boolean, //Был ли использован этот код для потверждения номера телефона
		ip: String, // ip адрес
		isCancelled: Boolean, // Отменен ли код подтверждения
	},
	{
		timestamps: true,
	}
)

module.exports = mongoose.model('PhoneChecking', phoneCheckingSchema)
