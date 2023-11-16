const { Schema, model } = require('mongoose')

const refferalLinkSchema = new Schema({
	url: {
		type: String,
		require: true,
		default: 'https://1390760-cu92735.tw1.ru',
	},
	code: {
		type: String,
		require: true,
	},
	count: {
		type: Number,
		default: 0,
	},
	user: {
		type: Schema.Types.ObjectId,
		ref: 'User',
	},
})

const refferalLinkModel = model('refferalLink', refferalLinkSchema)

module.exports = refferalLinkModel
