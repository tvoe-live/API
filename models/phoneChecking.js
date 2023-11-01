const mongoose = require('mongoose')

/*
 * Журнал подтверждений телефонов через смс
 */

const phoneCheckingSchema = new mongoose.Schema(
	{
		phone: String, // Номер телефона
		code: Number, // 4 значный код подтверждения
		attemptAmount: Number, // Число попыток
		isConfirmed: Boolean, //Был ли использован этот код для потверждения номера телефона
		ip: String, // ip адрес
		isCancelled: Boolean, // Отменен ли код подтверждения
		type: {
			type: String,
			enum: ['authorization', 'change'], // authorization - для авторизации / регистрации, change - для смены номера телефона
		},
		userId: mongoose.Schema.Types.ObjectId, // Id пользователя
	},
	{
		timestamps: true,
	}
)

module.exports = mongoose.model('PhoneChecking', phoneCheckingSchema)
