const mongoose = require('mongoose')

/*
 * Журнал пользователей c отзывами пользователей
 */

const movieRatingSchema = new mongoose.Schema(
	{
		movieId: mongoose.Schema.Types.ObjectId,
		userId: mongoose.Schema.Types.ObjectId,
		rating: Number,
		review: String,
		isPublished: Boolean,
		isDeleted: Boolean,
		deletingInfo: {
			comment: String, //Комментарий почему удален отзыв
			reasons: {
				// Список выбранных пользователем причин
				type: Array,
				required: true,
				validate: {
					validator: (arrReasons) => {
						const validValues = [
							'other', // Другое
							'swearingInsultsOrCallsIllegalActions', // Мат, оскорбления или призыв к противоправным действиям
							'linkOrAdvertising', // Отзыв со ссылкой или скрытой рекламой
							'missingRelationshipToContent', // Отзыв не имеет отношения к контенту
						]
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

module.exports = mongoose.model('MovieRating', movieRatingSchema)
