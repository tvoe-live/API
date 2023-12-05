const express = require('express')
const router = express.Router()
const verify = require('../../middlewares/verify')
const resError = require('../../helpers/resError')
const MoviePageLog = require('../../models/moviePageLog')
const getSearchQuery = require('../../middlewares/getSearchQuery')

/*
 * Админ-панель > История просмотров
 */

// Получение списка пользователей
router.get('/', verify.token, verify.isAdmin, getSearchQuery, async (req, res) => {
	const skip = +req.query.skip || 0
	const limit = +(req.query.limit > 0 && req.query.limit <= 100 ? req.query.limit : 100)

	const dateFilterParam = req.query.start && {
		$and: [
			{ createdAt: { $gte: new Date(req.query.start) } },
			{ createdAt: { $lt: new Date(req.query.end ? req.query.end : new Date()) } },
		],
	}

	const searchMoviesMatch = req.RegExpQuery && {
		name: req.RegExpQuery,
	}

	try {
		const result = await MoviePageLog.aggregate([
			{
				$facet: {
					// Всего записей
					totalSize: [
						{
							$match: {
								...searchMoviesMatch,
								...dateFilterParam,
							},
						},
						{
							$lookup: {
								from: 'movies',
								localField: 'movieId',
								foreignField: '_id',
								pipeline: [{ $project: { _id: true } }],
								as: 'movie',
							},
						},
						{ $unwind: { path: '$movie' } },
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
							$match: {
								...dateFilterParam,
							},
						},
						{
							$lookup: {
								from: 'movies',
								localField: 'movieId',
								foreignField: '_id',
								pipeline: [
									{
										$match: {
											...searchMoviesMatch,
										},
									},
									{
										$project: {
											_id: false,
											name: true,
											poster: {
												src: true,
											},
											alias: true,
											publishedAt: true,
										},
									},
								],
								as: 'movie',
							},
						},
						{ $unwind: { path: '$movie' } },
						{
							$lookup: {
								from: 'users',
								localField: 'userId',
								foreignField: '_id',
								pipeline: [
									{
										$project: {
											role: true,
											avatar: true,
											firstname: true,
											tariffId: '$subscribe.tariffId',
											phone: '$authPhone',
										},
									},
									{
										$lookup: {
											from: 'tariffs',
											localField: 'tariffId',
											foreignField: '_id',
											pipeline: [
												{
													$project: {
														name: true,
													},
												},
											],
											as: 'tariff',
										},
									},
									{ $unwind: { path: '$tariff', preserveNullAndEmptyArrays: true } },
									{
										$project: {
											tariffName: '$tariff.name',
											role: true,
											avatar: true,
											firstname: true,
											phone: '$authPhone',
										},
									},
								],
								as: 'user',
							},
						},
						{ $unwind: { path: '$user', preserveNullAndEmptyArrays: true } },
						{
							$project: {
								__v: false,
								userId: false,
								movieId: false,
							},
						},
						{ $sort: { _id: -1 } }, // Была сортировка updatedAt
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
