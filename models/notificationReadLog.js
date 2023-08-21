const mongoose = require('mongoose');

/*
 * Журнал пользователей о прочтении уведомлений
 */

const notificationReadLogSchema = new mongoose.Schema({
	notificationId: mongoose.Schema.Types.ObjectId,
	userId: mongoose.Schema.Types.ObjectId,
}, {
	timestamps: true
})

module.exports = mongoose.model('NotificationReadLog', notificationReadLogSchema)
