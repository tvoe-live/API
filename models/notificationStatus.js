const mongoose = require('mongoose');

const notoficationStatusSchema = new mongoose.Schema({
	notificationId: mongoose.Schema.Types.ObjectId,
	userId: mongoose.Schema.Types.ObjectId,
	status: String,
}, {
	timestamps: true
})

module.exports = mongoose.model('NotificationStatus', notoficationStatusSchema)