const mongoose = require('mongoose')

/*
 * Журнал пользователей "Избранное"
 */

const movieFavoriteSchema = new mongoose.Schema(
	{
		movieId: { type: mongoose.Schema.Types.ObjectId, index: true },
		userId: { type: mongoose.Schema.Types.ObjectId, index: true },
		subprofileId: mongoose.Schema.Types.ObjectId,
		isFavorite: Boolean,
	},
	{
		timestamps: true,
	}
)

module.exports = mongoose.model('MovieFavorite', movieFavoriteSchema)
