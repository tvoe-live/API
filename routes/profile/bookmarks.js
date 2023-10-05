const express = require('express')
const router = express.Router()
const Movie = require('../../models/movie')
const verify = require('../../middlewares/verify')
const resError = require('../../helpers/resError')
const movieBookmark = require('../../models/movieBookmark')

/*
 * Профиль > Закладки
 */

//  Переделал по образу и подобию истории просмотров
router.get('/', verify.token, async (req, res) => {
	const skip = +req.query.skip || 0
	const limit = +(req.query.limit > 0 && req.query.limit <= 100 ? req.query.limit : 100)

	const agregationListForTotalSize = [
		{
			// Отбор по userID
			$match: {
				userId: req.user._id,
			},
		},
		{
			// Формирования соединения с моделью Movie
			$lookup: {
				from: 'movies',
				localField: 'movieId',
				foreignField: '_id',
				pipeline: [{ $project: { persons: false } }],
				as: 'movie',
			},
		},

		//  Документируем полученные соедененные данные
		{ $unwind: '$movie' },

		// Группируем данные
		{
			$group: {
				_id: '$movie._id',
				name: { $first: '$movie.name' },
				rating: { $first: '$movie.rating' },
				ageLevel: { $first: '$movie.ageLevel' },
				trailer: { $first: '$movie.trailer' },
				categoryAlias: { $first: '$movie.categoryAlias' },
				series: { $first: '$movie.series' },
				films: { $first: '$movie.films' },
				poster: { $first: '$movie.poster' },
				updatedAt: { $max: '$updatedAt' },
				alias: { $first: '$movie.alias' },
				dateReleased: { $first: '$movie.dateReleased' },
			},
		},
		{
			// Добавляем поля
			$addFields: {
				// URL фильма/сериала
				url: { $concat: ['/p/', '$alias'] },
				duration: {
					$switch: {
						branches: [
							// Если фильм
							{
								case: { $eq: ['$categoryAlias', 'films'] },
								then: {
									// Забираем фильм
									$sum: {
										$map: {
											input: '$films',
											as: 'item',
											in: '$$item.duration',
										},
									},
								},
							},
							// Если сериал
							{
								case: { $eq: ['$categoryAlias', 'serials'] },
								then: {
									// Забираем сезоны сериала
									$sum: {
										$map: {
											input: '$series',
											as: 'seasons',
											in: {
												$sum: {
													$map: {
														input: '$$seasons',
														as: 'item',
														in: '$$item.duration',
													},
												},
											},
										},
									},
								},
							},
						],
						default: 0,
					},
				},
			},
		},
		{
			// Передача на следующий этап полей данных
			$project: {
				url: true,
				duration: true,
				_id: true,
				name: true,
				rating: true,
				ageLevel: true,
				trailer: true,
				categoryAlias: true,
				dateReleased: true,
				poster: true,
				updatedAt: true,
				series: {
					$cond: {
						if: { $eq: ['$categoryAlias', 'serials'] },
						then: '$series',
						else: '$$REMOVE',
					},
				},
			},
		},
	]

	try {
		movieBookmark.aggregate([
			{
				$facet: {
					totalSize: [
						...agregationListForTotalSize,
						{
							$group: {
								_id: null,
								count: { $sum: 1 },
							},
						},
						{ $project: { _id: false } },
						{ $limit: 1 },
					],
					items: [
						...agregationListForTotalSize,
						{ $sort: { updatedAt: -1 } },
						{ $skip: skip },
						{ $limit: limit },
					],
				},
			},
			{ $unwind: { path: '$totalSize', preserveNullAndEmptyArrays: true } },
			{
				$project: {
					totalSize: { $cond: ['$totalSize.count', '$totalSize.count', 0] },
					items: '$items',
				},
			},
			(_, result) => {
				return res.status(200).json(result[0])
			},
		])
	} catch (error) {
		return resError({ res, msg: err })
	}
})

module.exports = router
