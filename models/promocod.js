const mongoose = require('mongoose');

/*
 * Журнал всех промокодов
 */

const promocodSchema = new mongoose.Schema({
	title:String,
	value: String,
	type: String,  // Тип промокодов
	startAt: Date,
	finishAt: Date,
	deleted: Boolean,
}, {
	timestamps: true
})

module.exports = mongoose.model('Promocod', promocodSchema)
