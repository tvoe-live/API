const mongoose = require('mongoose');

const notificationSchema = new mongoose.Schema({
	title:String,
	description: String,
	type: { // Тип уведомлений - системные или премьера
		type: String,
		enum: ['system', 'premiere']
	},
	willPublishedAt: Date, // Планируемая дата публикации,
	img: {
		_id: mongoose.Schema.Types.ObjectId,
		src: String
	},
	deleted: Boolean,
	link: String,
	receiversIds: [mongoose.Schema.Types.ObjectId]
}, {
	timestamps: true
})

module.exports = mongoose.model('Notification', notificationSchema)