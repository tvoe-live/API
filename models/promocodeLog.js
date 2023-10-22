const mongoose = require('mongoose')

/*
 * Журнал пользователей об активации промокодов
 */

const promocodesLogSchema = new mongoose.Schema(
	{
		promocodeId: mongoose.Schema.Types.ObjectId, // Id промокода
		userId: mongoose.Schema.Types.ObjectId, // Id пользователя
		isCancelled: Boolean, // Отменен ли данный промокод пользователем
		isPurchaseCompleted: Boolean, // Совершена ли покупка по указанному промокоду
	},
	{
		timestamps: true,
	}
)

module.exports = mongoose.model('PromocodesLog', promocodesLogSchema)
