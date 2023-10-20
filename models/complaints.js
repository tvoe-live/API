const mongoose = require('mongoose')

/*
 * Журнал жалоб пользователей
 */

const complaintSchema = new mongoose.Schema(
	{
		// userId,
		// movieId,
		text: String, // Текст жалобы
		reasons: {
			// Список выбранных пользователем причин
			type: Array,
			required: true,
			validate: {
				validator: function (arrReasons) {
					const validValues = [
						'BAD_QUALITY_VIDEO', // Плохое качество видео
						'BAD_SOUND', // Плохой звук
						'BAD_SUBTITLES', // Плохо подобраны слова
						'AGE_LIMIT_VIOLATION', // Нарушение возрастного ограничения
					]
					for (let i = 0; i < arrReasons.length; i++) {
						if (!validValues.includes(arrReasons[i])) return false
					}
					return true
				},
				message: (props) =>
					`<${props.value}> - не валидное значение! Возможные варианты: 'BAD_QUALITY_VIDEO', 'BAD_SOUND', 'BAD_SUBTITLES', 'AGE_LIMIT_VIOLATION'`,
			},
		},
	},
	{
		timestamps: true,
	}
)

module.exports = mongoose.model('Complaint', complaintSchema)
