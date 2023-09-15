const mongoose = require('mongoose')

/*
 * Журнал пользователей "Буду смотреть"
 */

const movieBookmarkSchema = new mongoose.Schema(
	{
		movieId: { type: mongoose.Schema.Types.ObjectId, index: true },
		userId: { type: mongoose.Schema.Types.ObjectId, index: true },
		subprofileId: mongoose.Schema.Types.ObjectId,
		isBookmark: Boolean,
	},
	{
		timestamps: true,
	}
)

module.exports = mongoose.model('MovieBookmark', movieBookmarkSchema)
