const mongoose = require('mongoose')

/*
 * Здесь логируются файлы, которые нужно удалить с S3
 */

const cleanupLogSchema = new mongoose.Schema(
	{
		src: String,
		thumbnail: String,
	},
	{
		timestamps: true,
	}
)

module.exports = mongoose.model('CleanupLog', cleanupLogSchema)
