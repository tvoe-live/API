const mongoose = require('mongoose');

const moviePageLogSchema = new mongoose.Schema({
	device: Object,
	referer: String,
	startTime: Number,
	endTime: Number,
	userId: mongoose.Schema.Types.ObjectId,
	movieId: mongoose.Schema.Types.ObjectId,
	videoId: mongoose.Schema.Types.ObjectId
}, {
	timestamps: true
})

module.exports = mongoose.model('MoviePageLog', moviePageLogSchema)