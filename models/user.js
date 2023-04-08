const mongoose = require('mongoose');

const userSchema = new mongoose.Schema({
	initial_email: String,
	initial_id: String,
	initial_sex: String,
	initial_birthday: String,
	initial_firstname: String,
	initial_lastname: String,
	initial_client_id: String,
	initial_displayName: String,

	email: String,
	avatar: String,
	sex: String,
	birthday: String,
	firstname: String,
	lastname: String,
	displayName: String,

	sessions: [{
		token: String,
		ip: String,
		os: String,
		isBot: Boolean,
		isMobile: Boolean,
		isDesktop: Boolean,
		browser: String,
		version: String,
		platform: String,
		createdAt: Date
	}],

	subscribe: { // Равен null, если подписка не действует
		startAt: Date, // Начало подписки
		finishAt: Date, // Конец подписки
		tariffId: mongoose.Schema.Types.ObjectId,
		type: Object,
		default: null
	},
	allowTrialTariff: {
		type: Boolean, // Воспользовался ли пробным бесплатным тарифом
		default: true
	},
	referrerUserId: mongoose.Schema.Types.ObjectId, // От какого Id пользователя был приглашен

	role: String,
	lastVisitAt: Date,
	banned: Object, // Дата блокировки и восстановления
	deleted: Object // Дата удаления и восстановления
}, {
	timestamps: true
})

module.exports = mongoose.model('User', userSchema)