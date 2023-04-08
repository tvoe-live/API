const express = require('express');
const router = express.Router();
const mongoose = require('mongoose');
const Tariff = require('../../models/tariff');
const verify = require('../../middlewares/verify');
const resError = require('../../helpers/resError');
const PaymentLog = require('../../models/paymentLog');

/*
 * Профиль > Подписка
 */

router.get('/', verify.token, async (req, res) => {
	const cursorId = mongoose.Types.ObjectId(req.query.cursorId);
	const limit = +(req.query.limit > 0 && req.query.limit <= 100 ? req.query.limit : 100);

	const cursorMatch = req.query.cursorId ? { 
		_id: { $lt: cursorId } 
	} : null;
	
	const searchMatch = {
		userId: req.user._id,
		startAt: { $ne: null },
		finishAt: { $ne: null },
	};

	try {
		let tariffs = await Tariff.aggregate([
			{ $project: {
				duration: false
			} },
			{ $limit: 4 }
		]);
			
		const result = await PaymentLog.aggregate([
			{ "$facet": {
				"tariffs": [
					{ $lookup: {
						from: "tariffs",
						pipeline: [],
						as: "tariffs"
					} },
					{ $unwind: "$tariffs" },
					{ $project: {
						tariffs: true
					} },
					{ $limit: 4 }
				],
				// Всего записей
				"totalSize": [
					{ $match: { 
						...searchMatch,
					} },
					{ $group: { 
						_id: null, 
						count: { $sum: 1 }
					} },
					{ $project: { _id: false } },
					{ $limit: 1 }
				],
				// Список
				"items": [
					{ $match: { 
						...searchMatch,
						...cursorMatch,
					} },
					{ $lookup: {
						from: "tariffs",
						localField: "tariffId",
						foreignField: "_id",
						as: "tariff"
					} },
					{ $unwind: "$tariff" },
					{ $project: {
						type: true,
						startAt: true,
						finishAt: true,
						withdrawAmount: true,
						notificationType: true,
						tariff: {
							_id: true,
							name: true,
							price: true
						}
					} },
					{ $sort : { _id: -1 } },
					{ $limit: limit }
				]
				
			} },
			{ $limit: 1 },
			{ $unwind: { path: "$totalSize", preserveNullAndEmptyArrays: true } },
			{ $project: {
				last: "$last",
				totalSize: { $cond: [ "$totalSize.count", "$totalSize.count", 0] },
				items: "$items"
			} },
		]);

		return res.status(200).json({
			currentSubscribe: req.user.subscribe,
			tariffs,
			...result[0]
		});
	} catch(err) {
		return resError({ res, msg: err });
	}
});

module.exports = router;