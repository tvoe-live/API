const { Schema, model } = require('mongoose')

const cronTaskSchema = new Schema({
	id: {
		type: String,
		require: true,
	},
	period: {
		type: String,
		require: true,
	},
	prefix: {
		type: String,
		require: true,
	},
	isDeleted: {
		type: Boolean,
		default: false,
	},
})

const cronTaskModel = model('cronTask', cronTaskSchema)

module.exports = cronTaskModel
