const mongoose = require('mongoose');

const notoficationStatusSchema = new mongoose.Schema({
	notificationId: mongoose.Schema.Types.ObjectId,
	userId: mongoose.Schema.Types.ObjectId,
	isUnread: Boolean // Флаг, означающий является ли уведомление не прочитанным
}, {
	timestamps: true
})

module.exports = mongoose.model('NotificationStatus', notoficationStatusSchema)