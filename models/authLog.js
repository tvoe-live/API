const mongoose = require('mongoose');

const authLogSchema = new mongoose.Schema({
	userId: mongoose.Schema.Types.ObjectId,
	type: String, // LOGIN | LOGOUT
	token: String
}, {
	timestamps: true
})

module.exports = mongoose.model('AuthLog', authLogSchema)