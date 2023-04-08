const mongoose = require('mongoose');

const paymentLogSchema = new mongoose.Schema({
	userId: mongoose.Schema.Types.ObjectId,
	tariffId: mongoose.Schema.Types.ObjectId,
	type: String,
	startAt: Date,
	finishAt: Date,
	sender: Number,
	amount: Number,
	status: String,
	operationId: String,
	withdrawAmount: Number,
	notificationType: String,
}, {
	timestamps: true
})

module.exports = mongoose.model('PaymentLog', paymentLogSchema)