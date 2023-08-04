const mongoose = require('mongoose');

const movieBookmarkSchema = new mongoose.Schema({
	movieId: mongoose.Schema.Types.ObjectId,
	userId: mongoose.Schema.Types.ObjectId,
	isBookmark: Boolean
}, {
	timestamps: true
})

module.exports = mongoose.model('MovieBookmark', movieBookmarkSchema)