const { Schema, model } = require('mongoose')

const repaymentSchema = new Schema(
	{
		user: {
			type: Schema.Types.ObjectId,
			ref: 'user',
		},
		count: {
			type: Number,
			default: 0,
		},
		tariff: {
			type: Schema.Types.ObjectId,
			ref: 'tariff',
		},
	},
	{ timestamps: true }
)

const repaymentModel = model('repayment', repaymentSchema)

module.exports = repaymentModel
