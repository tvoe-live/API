const mongoose = require('mongoose');

const tariffSchema = new mongoose.Schema({
	name: String,
	sort: Number,
	price: Number,
	hidden: Boolean,
	duration: String
}, {
	versionKey: false
})

module.exports = mongoose.model('Tariff', tariffSchema)