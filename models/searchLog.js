const mongoose = require('mongoose');

const searchLogSchema = new mongoose.Schema({
	query: String,
	device: Object,
	userId: mongoose.Schema.Types.ObjectId
}, {
	timestamps: true
})

module.exports = mongoose.model('SearchLog', searchLogSchema)