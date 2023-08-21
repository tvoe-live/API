const mongoose = require('mongoose');

/*
 * Журнал пользователей "Буду смотреть"
 */

const movieBookmarkSchema = new mongoose.Schema({
	movieId: mongoose.Schema.Types.ObjectId,
	userId: mongoose.Schema.Types.ObjectId,
	isBookmark: Boolean
}, {
	timestamps: true
})

module.exports = mongoose.model('MovieBookmark', movieBookmarkSchema)