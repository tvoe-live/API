const mongoose = require('mongoose')

/*
 * Журнал всех входов и выходов пользователями
 */

const authLogSchema = new mongoose.Schema(
	{
		userId: mongoose.Schema.Types.ObjectId,
		type: {
			type: String,
			enum: [
				'LOGIN', // Выполнен вход
				'LOGOUT', // Выполнен выход
			],
		},
		token: String, // JWT токен
	},
	{
		timestamps: true,
	}
)

module.exports = mongoose.model('AuthLog', authLogSchema)
