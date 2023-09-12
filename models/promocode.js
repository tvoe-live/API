const mongoose = require("mongoose");

/*
 * Журнал всех промокодов
 */

const promocodeSchema = new mongoose.Schema(
	{
		title: String, // Название промокода
		value: String, // Комбинация символов, которую юзер вводит в качестве значения промокода
		type: String, // Тип промокодов
		startAt: Date, // Дата начала действия промокода
		finishAt: Date, // Дата окончания действия промокода
		deleted: Boolean, // Флаг отвечающий за то, удален ли промокод или нет
	},
	{
		timestamps: true,
	},
);

module.exports = mongoose.model("Promocode", promocodeSchema);
