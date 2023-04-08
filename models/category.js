const mongoose = require('mongoose');

const categorySchema = new mongoose.Schema({
	name: {
		required: true,
		type: String
	},
	alias: {
		required: true,
		type: String
	},
	deleted: Boolean
}, {
	versionKey: false
})

module.exports = mongoose.model('Category', categorySchema)