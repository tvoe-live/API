const mongoose = require('mongoose')

/*
 * Журнал пользователей просмотра видео (не трейлеров)
 */

const moviePageLogSchema = new mongoose.Schema(
	{
		device: Object,
		referer: String,
		startTime: Number,
		endTime: Number,
		userId: {
			type: mongoose.Schema.Types.ObjectId,
			index: true,
		},
		movieId: {
			type: mongoose.Schema.Types.ObjectId,
			index: true,
		},
		videoId: {
			type: mongoose.Schema.Types.ObjectId,
			index: true,
		},
	},
	{
		timestamps: true,
	}
)

module.exports = mongoose.model('MoviePageLog', moviePageLogSchema)
