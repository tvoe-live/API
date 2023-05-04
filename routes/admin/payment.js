const express = require('express');
const router = express.Router();
const mongoose = require('mongoose');
const Tariff = require('../../models/tariff');
const verify = require('../../middlewares/verify');
const resError = require('../../helpers/resError');
const PaymentLog = require('../../models/paymentLog');
const getSearchQuery = require('../../middlewares/getSearchQuery');

/*
 * Админ-панель > История пополнений
 */

// Получение списка пользователей
router.get('/', verify.token, verify.isAdmin, getSearchQuery, async (req, res) => {
	const skip = +req.query.skip || 0
	const limit = +(req.query.limit > 0 && req.query.limit <= 100 ? req.query.limit : 100)
	
	const searchMatch = req.RegExpQuery && {
		$or: [
			{ _id: req.RegExpQuery },
			{ email: req.RegExpQuery },
			{ firstname: req.RegExpQuery }
		]
	};

	try {
		let tariffsStats = await Tariff.aggregate([
			// Действующие подписок
			{ $lookup: {
				from: "paymentlogs",
				localField: "_id",
				foreignField: "tariffId",
				pipeline: [
					{ $match: {
						finishAt: { $gte: new Date() }
					} },
					{ $group: { 
						_id: null, 
						count: { $sum: 1 }
					} },
					{ $project: { _id: false } },
					{ $limit: 1 }
				],
				as: "activeSubscriptions"
			} },
			// Активаций подписок
			{ $lookup: {
				from: "paymentlogs",
				localField: "_id",
				foreignField: "tariffId",
				pipeline: [
					{ $match: {
						finishAt: { $ne: null }
					} },
					{ $group: { 
						_id: null, 
						count: { $sum: 1 }
					} },
					{ $project: { _id: false } },
					{ $limit: 1 }
				],
				as: "activationsSubscriptions"
			} },
			// Сумма всех пополнений
			{ $lookup: {
				from: "paymentlogs",
				localField: "_id",
				foreignField: "tariffId",
				pipeline: [
					{ $match: {
						status: 'success'
					} },
					{ $group: { 
						_id: null, 
						count: { $sum: "$withdrawAmount" }
					} },
					{ $project: { _id: false } },
					{ $limit: 1 }
				],
				as: "totalWithdrawAmount"
			} },
			{ $unwind: { path: "$totalWithdrawAmount", preserveNullAndEmptyArrays: true } },
			{ $unwind: { path: "$activeSubscriptions", preserveNullAndEmptyArrays: true } },
			{ $unwind: { path: "$activationsSubscriptions", preserveNullAndEmptyArrays: true } },
			{ $project: {
				name: true,
				duration: true,
				totalWithdrawAmount: { $cond: [ "$totalWithdrawAmount.count", "$totalWithdrawAmount.count", 0] },
				activeSubscriptions: { $cond: [ "$activeSubscriptions.count", "$activeSubscriptions.count", 0] },
				activationsSubscriptions: { $cond: [ "$activationsSubscriptions.count", "$activationsSubscriptions.count", 0] },
			} },
			{ $sort: { duration: 1 } },
			{ $limit: 5 }
		]);

		const result = await PaymentLog.aggregate([
			{ "$facet": {
				// Всего записей
				"totalSize": [
					{ $match: {
						status: 'success'
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
						status: 'success'
					} },
					{ $lookup: {
						from: "tariffs",
						localField: "tariffId",
						foreignField: "_id",
						pipeline: [
							{ $project: {
								_id: false,
								name: true
							} }
						],
						as: "tariff"
					} },
					{ $unwind: { path: "$tariff" } },
					{ $lookup: {
						from: "users",
						localField: "userId",
						foreignField: "_id",
						pipeline: [
							{ $match: {
								...searchMatch
							} },
							{ $project: {
								role: true,
								email: true,
								avatar: true,
								subscribe: true,
								firstname: true,
							} }
						],
						as: "user"
					} },
					{ $unwind: { path: "$user" } },
					{ $project: {
						user: true,
						tariff: true,
						startAt: true,
						finishAt: true,
						updatedAt: true,
						withdrawAmount: true
					} },
					{ $sort: { _id: -1 } }, // Была сортировка updatedAt
					{ $skip: skip },
					{ $limit: limit },
				]
				
			} },
			{ $limit: 1 },
			{ $unwind: { path: "$totalWithdrawAmount", preserveNullAndEmptyArrays: true } },
			{ $unwind: { path: "$totalSize", preserveNullAndEmptyArrays: true } },
			{ $project: {
				totalWithdrawAmount: { $cond: [ "$totalWithdrawAmount.count", "$totalWithdrawAmount.count", 0] },
				totalSize: { $cond: [ "$totalSize.count", "$totalSize.count", 0] },
				items: "$items"
			} },
		]);

		return res.status(200).json({
			tariffsStats,
			...result[0]
		});

	} catch(err) {
		return resError({ res, msg: err });
	}
});


module.exports = router;