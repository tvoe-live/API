const mongoose = require('mongoose')

/*
 * Журнал всех промокодов
 */

const promocodeSchema = new mongoose.Schema(
	{
		maxAmountActivation: Number, // Максимальное количество возможных активаций промокода. Если в этом поле null, значит промокод можно активировать неограниченное кол-во раз
		currentAmountActivation: Number, // Текущее количество активаций промокода
		isOnlyForNewUsers: Boolean, // Доступен ли промокод только новым пользователем или нет. Пользователь считается новым если он прежде не оплачивал подписку
		isActive: Boolean, // Является ли промокод активным в данный момент
		tariffName: {
			// Вид тарифа
			type: String,
			enum: ['1 месяц', '3 месяца', '6 месяцев', 'universal'],
		},
		discountFormat: {
			// Формат скидки
			type: String,
			enum: [
				'percentages', // в процентах
				'rubles', // в рублях
				'free', // бесплатный
			],
		},
		sizeDiscount: Number, // Размер скидки - число в рублях (если discountFormat = rubles) или процентах ( если discountFormat = percentages). Если discountFormat = free, тогда sizeDiscount = null
		value: String, // Комбинация символов, которую пользователь вводит в качестве значения промокода
		startAt: Date, // Дата начала действия промокода
		finishAt: Date, // Дата окончания действия промокода. Если в этом поле null, значит промокод бессрочный
		deleted: Boolean, // Флаг отвечающий за то, удален ли промокод или нет
	},
	{
		timestamps: true,
	}
)

module.exports = mongoose.model('Promocode', promocodeSchema)
