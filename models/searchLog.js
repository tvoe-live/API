const mongoose = require('mongoose');

/*
 * Журнал всех записей что ищут пользователи в поиске
 */

const searchLogSchema = new mongoose.Schema({
	query: String,
	device: Object,
	userId: mongoose.Schema.Types.ObjectId
}, {
	timestamps: true
})

module.exports = mongoose.model('SearchLog', searchLogSchema)