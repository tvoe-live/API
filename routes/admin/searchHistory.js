const express = require('express')
const router = express.Router()
const mongoose = require('mongoose')
const verify = require('../../middlewares/verify')
const resError = require('../../helpers/resError')
const SearchLog = require('../../models/searchLog')
const getSearchQuery = require('../../middlewares/getSearchQuery')
const isValidObjectId = require('../../helpers/isValidObjectId')

/*
 * Админ-панель > История поиска
 */

// Получение списка пользователей
router.get('/', verify.token, verify.isAdmin, getSearchQuery, async (req, res) => {
	const skip = +req.query.skip || 0
	const limit = +(req.query.limit > 0 && req.query.limit <= 100 ? req.query.limit : 100)

	const searchMatch = req.RegExpQuery && {
		$or: [
			...(isValidObjectId(req.searchQuery)
				? [{ _id: mongoose.Types.ObjectId(req.searchQuery) }]
				: []),
			{ email: req.RegExpQuery },
			{ firstname: req.RegExpQuery },
		],
	}

	try {
		const result = await SearchLog.aggregate([
			{
				$facet: {
					// Всего записей
					totalSize: [
						{
							$lookup: {
								from: 'users',
								localField: 'userId',
								foreignField: '_id',
								pipeline: [
									{
										$project: {
											role: true,
											email: true,
											avatar: true,
											firstname: true,
										},
									},
								],
								as: 'user',
							},
						},
						{ $unwind: { path: '$user', preserveNullAndEmptyArrays: true } },
						{
							$group: {
								_id: null,
								count: { $sum: 1 },
							},
						},
						{ $project: { _id: false } },
						{ $limit: 1 },
					],
					// Список
					items: [
						{
							$lookup: {
								from: 'users',
								localField: 'userId',
								foreignField: '_id',
								pipeline: [
									{
										$match: {
											...searchMatch,
										},
									},
									{
										$project: {
											role: true,
											email: true,
											avatar: true,
											subscribe: true,
											firstname: true,
										},
									},
								],
								as: 'user',
							},
						},
						{
							$unwind: {
								path: '$user',
								preserveNullAndEmptyArrays: !req.searchQuery,
							},
						},
						{
							$project: {
								__v: false,
								userId: false,
								movieId: false,
								createdAt: false,
							},
						},
						{ $sort: { _id: -1 } },
						{ $skip: skip },
						{ $limit: limit },
					],
				},
			},
			{ $limit: 1 },
			{ $unwind: { path: '$totalSize', preserveNullAndEmptyArrays: true } },
			{
				$project: {
					totalSize: { $cond: ['$totalSize.count', '$totalSize.count', 0] },
					items: '$items',
				},
			},
		])

		return res.status(200).json(result[0])
	} catch (err) {
		return resError({ res, msg: err })
	}
})

module.exports = router
