const mongoose = require('mongoose');

/*
 * Журнал удалений аккаунтов
 */

const deletingProfileLogSchema = new mongoose.Schema({
	userId: mongoose.Schema.Types.ObjectId,
	isRefund: Boolean, // Хочет ли пользователь оформить возврат средств за оставшиеся дни подписки
	reason: {
		text: String, // Комментарий пользователя почему хочет удалить аккаунт
		types: { // Список выбранных пользователем причин
			type: Array,
			required: true,
			validate: {
				validator: function(arrReasons) {
					const validValues = ['NOT_ENOUGH_CONTENT', 'BAD_QUALITY_VIDEO', 'BAD_SOUND', 'NOT_MATCH_TARIFF', 'HIGH_COST_SUBSCRIBTION']
					for ( let i=0; i<arrReasons.length; i++){
						if(!validValues.includes(arrReasons[i])) return false
					}
					return true
				},
				message: props => `<${props.value}> - не валидное значение! Возможные варианты: 'NOT_ENOUGH_CONTENT', 'BAD_QUALITY_VIDEO', 'BAD_SOUND', 'NOT_MATCH_TARIFF', 'HIGH_COST_SUBSCRIBTION'`
			},
		}
	},
	refundStatus: {								// Статус возврата
		type: String,
		enum: [
			'CONFIRMED',				// Операция подтверждена
			'REJECTED',					// Операция отклонена
			'WAITING',					// Операция в режиме ожидания
		]
	},
	refundAmount: Number, //Cумма денег для возврата пользователю ( если значение isRefund = true)
}, {
	timestamps: true
})

module.exports = mongoose.model('DeletingProfileLog', deletingProfileLogSchema)
