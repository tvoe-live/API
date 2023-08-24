const mongoose = require('mongoose');

/*
 *  Возврат денежных средств
 */

const withdrawalLogSchema = new mongoose.Schema({
	userId: mongoose.Schema.Types.ObjectId, // ID пользователя отправившего заявку
	status: { // Статус операции
		type: String,
		enum: [
			'WAITING', // Операция в режиме ожидания
			'CANCELLED', // В операции отказано
			'SUCCESS', // Операция успешно проведена
		]
	},
	reason: { // Причина для возврата денедных средств
		type:{  // Тип причины возврата
			type: String,
			enum: [
				'NOT_ENOUGH_CONTENT', // Не достаточно контента
				'BAD_QUALITY_VIDEO', // Плохое качество видео
				'BAD_SOUND', // Плохой звук
			]
		},
		text: String, // Комментарий пользователя о причине возврата
	},
}, {
	timestamps: true
})

module.exports = mongoose.model('WithdrawalLog', withdrawalLogSchema)
