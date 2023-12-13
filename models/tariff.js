const mongoose = require('mongoose')

/*
 * Список тарифов
 */

const tariffSchema = new mongoose.Schema(
	{
		name: String, // Название
		sort: Number, // Сортировка
		price: Number, // Цена
		hidden: Boolean, // Скрыт ли нет
		duration: String, // Длительность,
		autoSwitchingFromTrialTariff: {
			type: Boolean,
			default: false,
		},
	},
	{
		versionKey: false,
	}
)

module.exports = mongoose.model('Tariff', tariffSchema)
