const mongoose = require('mongoose');

/*
 * Список пользователей
 */

const userSchema = new mongoose.Schema({
	initial_email: String,
	initial_id: String,
	initial_sex: String,
	initial_phone: String,
	initial_birthday: String,
	initial_firstname: String,
	initial_lastname: String,
	initial_client_id: String,
	initial_displayName: String,

	email: String,
	avatar: String,
	sex: String,
	phone: String,
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
		type: Boolean, // Разрешить воспользоваться пробным тарифом
		default: true // По умолчанию разрешено
	},

	refererUserId: mongoose.Schema.Types.ObjectId, // От какого ID пользователя был приглашен по реферальной программе
	referral: {
		balance: { // Баланс в реферальной программе
			type: Number,
			default: 0
		},
		card: { // Данные карты для вывода баланса
			number: String, // Номер карты
			cardholder: String, // Владелец карты
		},
		userIds: [mongoose.Schema.Types.ObjectId], // ID приглашенных пользователей по реферальной программе
	},


	role: String, // Роль пользователя: admin или manager. Для обычных пользователей это поле отсутствует, у них нет роли.
	lastVisitAt: Date, // Дата последнего визита
	banned: Object, // Дата блокировки и восстановления
	deleted: Object, // Дата удаления и восстановления
	disabledNotifications: { // Типы отключенных уведомлений
		type: Array,
		required: true,
		validator: function(arrTypes) {
			const validValues = ['SERVICE_NEWS', 'GIFTS_AND_PROMOTIONS', 'PROFILE', 'CINEMA_NEWS', 'SERVICE_NOVELTIES', 'FAVOTITES_AND_BOOKMARKS_NEWS']
			for ( let i=0; i<arrTypes.length; i++){
				if(!validValues.includes(arrTypes[i])) return false
			}
			return true
		},
		message: props => `<${props.value}> - не валидное значение! Возможные варианты: 'SERVICE_NEWS', 'GIFTS_AND_PROMOTIONS', 'PROFILE', 'CINEMA_NEWS', 'SERVICE_NOVELTIES', 'FAVOTITES_AND_BOOKMARKS_NEWS'`
	},
}, {
	timestamps: true
})

module.exports = mongoose.model('User', userSchema)
