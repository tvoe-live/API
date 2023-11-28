const mongoose = require('mongoose')

const disposibleCronTaskSchema = new mongoose.Schema({
	name: {
		//  Название задачи
		type: String,
		require: true,
		enum: [
			'sendMsgViaPhone', // Отправить сообщение через телефон
			'sendMsgViaEmail', // Отправить сообщение через емайл
		],
	},
	phone: {
		type: String,
		require: false, // если название задачи - 'sendMsgViaPhone', то это поле обязательное
	},
	email: {
		type: String,
		require: false, // если название задачи - 'sendMsgViaEmail', то это поле обязательное
	},
	message: {
		type: String,
		require: false, // если название задачи - 'sendMsgViaEmail' или 'sendMsgViaPhone', то это поле обязательное
	},
	willCompletedAt: {
		type: Date,
		require: true,
	},
})

module.exports = mongoose.model('DisposibleCronTask', disposibleCronTaskSchema)
