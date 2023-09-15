const mongoose = require('mongoose');

/*
 * Журнал пользователей просмотра видео (не трейлеров)
 */

const moviePageLogSchema = new mongoose.Schema({
	device: Object,
	referer: String,
	startTime: Number,
	endTime: Number,
	movieId: {type: mongoose.Schema.Types.ObjectId, index: true},
	userId:  {type: mongoose.Schema.Types.ObjectId, index: true},
	subprofileId: mongoose.Schema.Types.ObjectId,
	videoId: mongoose.Schema.Types.ObjectId
}, {
	timestamps: true
})

module.exports = mongoose.model('MoviePageLog', moviePageLogSchema)
