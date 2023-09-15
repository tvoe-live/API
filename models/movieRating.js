const mongoose = require('mongoose')

/*
 * Журнал оценок пользователей
 */

const movieRatingSchema = new mongoose.Schema(
	{
		movieId: mongoose.Schema.Types.ObjectId,
		userId: mongoose.Schema.Types.ObjectId,
		subprofileId: mongoose.Schema.Types.ObjectId,
		rating: Number,
		review: String,
	},
	{
		timestamps: true,
	}
)

module.exports = mongoose.model('MovieRating', movieRatingSchema)
