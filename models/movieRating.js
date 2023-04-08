const mongoose = require('mongoose');

const movieRatingSchema = new mongoose.Schema({
	movieId: mongoose.Schema.Types.ObjectId,
	userId: mongoose.Schema.Types.ObjectId,
	rating: Number
}, {
	timestamps: true
})

module.exports = mongoose.model('MovieRating', movieRatingSchema)