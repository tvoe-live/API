const { Schema, model } = require('mongoose')

const cronTaskSchema = new Schema({
	name: {
		type: String,
		require: true,
	},
	period: {
		type: String,
		require: true,
	},
})

const cronTaskModel = model('cronTask', cronTaskSchema)

module.exports = cronTaskModel
