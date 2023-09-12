const mongoose = require("mongoose");

/*
 * Журнал пользователей об активации промокодов
 */

const promocodesLogSchema = new mongoose.Schema(
	{
		promocodeId: mongoose.Schema.Types.ObjectId,
		userId: mongoose.Schema.Types.ObjectId,
	},
	{
		timestamps: true,
	},
);

module.exports = mongoose.model("PromocodesLog", promocodesLogSchema);
