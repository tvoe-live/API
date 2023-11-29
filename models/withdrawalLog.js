const mongoose = require('mongoose')

/*
 *  Возврат денежных средств
 */

const withdrawalLogSchema = new mongoose.Schema(
	{
		userId: mongoose.Schema.Types.ObjectId, // ID пользователя отправившего заявку
		managerUserId: mongoose.Schema.Types.ObjectId, // ID менеджера рассотревшего заявку
		status: {
			// Статус операции
			type: String,
			enum: [
				'WAITING', // Операция в режиме ожидания
				'CANCELLED', // В операции отказано
				'SUCCESS', // Операция успешно проведена
			],
		},
		reason: {
			text: String, // Комментарий пользователя почему хочет вернуть деньги
			types: {
				// Список выбранных пользователем причин
				type: Array,
				required: true,
				validate: {
					validator: (arrReasons) => {
						const validValues = ['NOT_ENOUGH_CONTENT', 'BAD_QUALITY_VIDEO', 'BAD_SOUND']
						for (let i = 0; i < arrReasons.length; i++) {
							if (!validValues.includes(arrReasons[i])) return false
						}
						return true
					},
					message: (props) =>
						`<${props.value}> - не валидное значение! Возможные варианты: ${validValues
							.map((d) => `'${d}'`)
							.join()}`,
				},
			},
		},
	},
	{
		timestamps: true,
	}
)

module.exports = mongoose.model('WithdrawalLog', withdrawalLogSchema)
