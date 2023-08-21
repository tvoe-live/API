const mongoose = require('mongoose');

/*
 * Журнал пользователей "Избранное"
 */

const movieFavoriteSchema = new mongoose.Schema({
	movieId: mongoose.Schema.Types.ObjectId,
	userId: mongoose.Schema.Types.ObjectId,
	isFavorite: Boolean
}, {
	timestamps: true
})

module.exports = mongoose.model('MovieFavorite', movieFavoriteSchema)