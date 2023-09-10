const mongoose = require('mongoose');

/*
 * Журнал всех уведомлений
 */

const notificationSchema = new mongoose.Schema({
	title:String,
	description: String,
	type: { // Тип уведомлений - Новости сервиса, подарки и акции, профиль (напоминание об окончании подписки и индивидуальные предложения), Новинки кинематографа, новинки на сервисе, новинки из раздела "Избранное" и "Буду смотреть"
		type: String,
		enum: ['SERVICE_NEWS', 'GIFTS_AND_PROMOTIONS', 'PROFILE', 'CINEMA_NEWS', 'SERVICE_NEWS', 'FAVOTITES_AND_BOOKMARKS_NEWS']
	},
	willPublishedAt: Date, // Планируемая дата публикации,
	img: {
		_id: mongoose.Schema.Types.ObjectId,
		src: String
	},
	deleted: Boolean,
	link: String,
	receiversIds: [mongoose.Schema.Types.ObjectId]
}, {
	timestamps: true
})

module.exports = mongoose.model('Notification', notificationSchema)
