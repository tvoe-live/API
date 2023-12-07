const express = require('express')
const router = express.Router()
const Movie = require('../models/movie')
const resError = require('../helpers/resError')
const resSuccess = require('../helpers/resSuccess')
const movieOperations = require('../helpers/movieOperations')
const verify = require('../middlewares/verify')
const MoviePageLog = require('../models/moviePageLog')

const carousel = [
	{
		$lookup: {
			from: 'moviepagelogs',
			localField: '_id',
			foreignField: 'movieId',
			pipeline: [
				{
					$match: {
						updatedAt: {
							$gte: new Date(new Date() - 3 * 60 * 60 * 24 * 1000),
						},
					},
				},
				{
					$group: {
						_id: '$userId',
						items: {
							$push: '$$ROOT',
						},
					},
				},
				{
					$project: {
						_id: false,
						series: false,
					},
				},
			],
			as: 'countPageViewed',
		},
	},
	...movieOperations({
		addToProject: {
			_id: true,
			poster: { src: true },
			logo: { src: true },
			cover: { src: true },
			genreName: { $first: '$genres.name' },
			countPageViewed: { $size: '$countPageViewed' },
			shortDesc: true,
		},
		sort: { countPageViewed: -1, raisedUpAt: -1, publishedAt: -1 },
	}),
]

/*
 * Подборки и жанры для главной страницы
 */

router.get('/', async (req, res) => {
	const limit = +(req.query.limit >= 6 && req.query.limit <= 15 ? req.query.limit : 15)

	const projectWillSoon = {
		_id: false,
		name: true,
		ageLevel: true,
		shortDesc: true,
		fullDesc: true,
		willPublishedAt: true,
		poster: true,
		trailer: true,
		logo: true,
		cover: true,
	}

	const projectRatingMore7 = {
		_id: false,
		name: true,
		badge: true,
		ageLevel: true,
		dateReleased: true,
		shortDesc: true,
		fullDesc: true,
		countries: true,
		genresAliases: true,
		poster: true,
		trailer: true,
		logo: true,
		cover: true,
		rating: true,
		categoryAlias: true,
		url: { $concat: ['/p/', '$alias'] },
	}

	const today = new Date()
	const year = today.getFullYear()
	const month = today.getMonth()
	const day = today.getDate()
	const dateWeekAgo = new Date(year, month, day - 7)

	try {
		const result = await Movie.aggregate([
			{
				$facet: {
					// willPublishedSoon: [
					// 	{
					// 		$match: {
					// 			willPublishedAt: { $gte: new Date() },
					// 		},
					// 	},
					// 	{ $project: projectWillSoon },
					// ],

					//Случайные фильмы с рейтингом 7+
					moviesWithRatingMore7: [
						{
							$match: {
								publishedAt: { $ne: null },
								rating: { $gte: 7 },
							},
						},
						{ $unwind: { path: '$rating', preserveNullAndEmptyArrays: false } },
						{ $project: projectRatingMore7 },
						{
							$sample: {
								size: limit,
							},
						},
					],

					//Топ 10 фильмов по просмотрам за неделю
					top10: [
						{
							$project: {
								_id: true,
								name: true,
								alias: true,
								poster: true,
							},
						},
						{
							$lookup: {
								from: 'moviepagelogs',
								localField: '_id',
								foreignField: 'movieId',
								pipeline: [
									{
										$project: {
											_id: true,
											movieId: true,
											videoId: true,
											updatedAt: true,
											endTime: true,
										},
									},
								],
								as: 'moviepagelog',
							},
						},
						{ $unwind: '$moviepagelog' },
						{
							$match: {
								'moviepagelog.updatedAt': {
									$gte: dateWeekAgo,
								},
							},
						},
						{
							$group: {
								_id: '$moviepagelog.videoId',
								count: { $sum: 1 },
								movieId: { $first: '$moviepagelog.movieId' },
								shortDesc: { $first: '$shortDesc' },
								name: { $first: '$name' },
								poster: { $first: '$poster' },
								alias: { $first: '$alias' },
							},
						},
						{ $sort: { count: -1 } },
						{
							$group: {
								_id: '$movieId',
								videoId: { $first: '$_id' },
								count: { $first: '$count' },
								shortDesc: { $first: '$shortDesc' },
								poster: { $first: '$poster' },
								name: { $first: '$name' },
								alias: { $first: '$alias' },
								count: { $first: '$count' },
							},
						},
						{ $sort: { count: -1 } },
						{ $limit: 10 },
					],
					// Карусель - самые популярные
					carousel: [
						...carousel,
						{ $limit: limit },
						{
							$project: {
								series: false,
								countPageViewed: false,
							},
						},
					],

					// Новинки
					new: [
						...movieOperations({
							addToProject: {
								poster: { src: true },
								_id: true,
							},
							sort: { raisedUpAt: -1, createdAt: -1 },
							limit: limit,
						}),
						{
							$project: {
								series: false,
								genres: false,
								trailer: false,
								ageLevel: false,
								dateReleased: false,
								categoryAlias: false,
							},
						},
					],
					// Жанры
					genres: [
						{
							$lookup: {
								from: 'moviepagelogs',
								localField: '_id',
								foreignField: 'movieId',
								pipeline: [
									{
										$match: {
											updatedAt: {
												$gte: new Date(new Date() - 3 * 60 * 60 * 24 * 1000),
											},
										},
									},
									{
										$group: {
											_id: '$userId',
											items: {
												$push: '$$ROOT',
											},
										},
									},
									{
										$project: {
											_id: true,
										},
									},
								],
								as: 'countPageViewed',
							},
						},
						...movieOperations({
							addToProject: {
								poster: { src: true },
								genres: { $first: '$genres' },
								countPageViewed: { $size: '$countPageViewed' },
							},
							limit: 200,
							sort: { raisedUpAt: -1, publishedAt: -1 },
						}),
						{ $unwind: { path: '$genres' } },
						{
							$group: {
								_id: '$genres',
								items: {
									$push: '$$ROOT',
								},
								countPageViewed: { $sum: '$countPageViewed' },
							},
						},
						{ $sort: { countPageViewed: -1 } },
						{
							$project: {
								_id: false,
								name: '$_id.name',
								items: '$items',
								url: { $concat: ['/collections/', '$_id.alias'] },
							},
						},
						{
							$project: {
								items: {
									series: false,
									genres: false,
									trailer: false,
									ageLevel: false,
									dateReleased: false,
									categoryAlias: false,
									countPageViewed: false,
								},
							},
						},
					],
				},
			},
			{
				$project: {
					collections: [
						{
							type: 'carousel',
							items: '$carousel',
						},
						{
							name: 'Новинки',
							type: 'new',
							items: '$new',
						},
						// {
						// 	name: 'Cкоро на сервисе',
						// 	type: 'willPublishedSoon',
						// 	items: '$willPublishedSoon',
						// 	url: '/collections/willPublishedSoon',
						// },
						{
							name: 'Cлучайныe фильмы с рейтингом 7+',
							type: 'randomMoviesWithRatingMore7',
							items: '$moviesWithRatingMore7',
						},
						{
							name: 'Топ 10 фильмов по просмотрам за неделю',
							type: 'top10',
							items: '$top10',
						},
					],
					genres: '$genres',
				},
			},
		])

		collections = [...result[0]['collections'], ...result[0]['genres']]

		const collectionsFiltered = collections
			.filter(
				(collection) =>
					collection.items.length >= 6 ||
					collection.type === 'randomMoviesWithRatingMore7' ||
					collection.type === 'willPublishedSoon'
			)
			.map((collection) => ({
				...collection,
				items: collection.items.slice(0, limit),
			}))

		return res.status(200).json(collectionsFiltered)
	} catch (err) {
		return resError({ res, msg: err })
	}
})

router.get('/continueWatching', verify.token, async (req, res) => {
	const skip = +req.query.skip || 0
	const limit = +(req.query.limit > 0 && req.query.limit <= 20 ? req.query.limit : 20)

	const titlesDuration = 10 * 60

	const lookup = {
		from: 'movies',
		localField: 'movieId',
		foreignField: '_id',
		pipeline: [
			{
				$project: {
					name: true,
					alias: true,
					series: true,
					categoryAlias: true,
					films: {
						duration: true,
					},
					poster: {
						src: true,
					},
					cover: {
						src: true,
					},
				},
			},
			{ $unwind: { path: '$films', preserveNullAndEmptyArrays: true } },
		],
		as: 'movie',
	}

	const project = {
		_id: true,
		videoId: true,
		movieId: true,
		endTime: true,
		updatedAt: true,
		isDeletedFromContinueWathcing: true,
		movie: {
			name: '$movie.name',
			alias: '$movie.alias',
			categoryAlias: '$movie.categoryAlias',
			filmDuration: '$movie.films.duration',
			poster: '$movie.poster',
			cover: '$movie.cover',
		},
		seriaInfo: {
			$function: {
				body: function (seasons, videoId) {
					if (!seasons.length) return null

					for (let i = 0; i < seasons.length; i++) {
						const season = seasons[i]

						for (let j = 0; j < season.length; j++) {
							const episode = season[j]
							if (String(episode._id) === String(videoId)) {
								return {
									season: i + 1,
									episode: j + 1,
									seriaDuration: episode.duration,
									thumbnail: episode.thumbnail,
								}
							}
						}
					}
				},
				args: ['$movie.series', '$videoId'],
				lang: 'js',
			},
		},
	}

	const match = {
		$or: [
			{
				$expr: {
					$gte: ['$seriaInfo.seriaDuration', { $sum: ['$endTime', titlesDuration] }], // Длительность СЕРИИ должна быть больше чем время окончания просмотра + титры ( если пользователь досмотрел серию до конца, то он не будет отображаться в разделе продолжить просмотр)
				},
			},
			{
				$expr: {
					$gte: ['$movie.filmDuration', { $sum: ['$endTime', titlesDuration] }], // Длительность ФИЛЬМА должна быть больше чем время окончания просмотра + титры ( если пользователь досмотрел фильм до конца, то он не будет отображаться в разделе продолжить просмотр)
				},
			},
		],
		isDeletedFromContinueWathcing: { $ne: true },
	}

	try {
		const logs = await MoviePageLog.aggregate([
			{
				$facet: {
					//Всего записей
					totalSize: [
						{
							$match: {
								userId: req.user._id,
							},
						},
						{ $lookup: lookup },
						{ $unwind: { path: '$movie' } },
						{ $project: project },
						{ $match: match },
						{
							$group: {
								_id: '$movieId',
								count: { $sum: 1 },
							},
						},
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
								userId: req.user._id,
							},
						},
						{ $lookup: lookup },
						{ $unwind: { path: '$movie' } },
						{ $project: project },
						{ $match: match },
						{
							$sort: {
								'seriaInfo.season': -1,
								'seriaInfo.episode': -1,
							},
						},
						{
							$group: {
								_id: '$movieId',
								videoId: { $first: '$videoId' },
								endTime: { $first: '$endTime' },
								updatedAt: { $first: '$updatedAt' },
								movie: { $first: '$movie' },
								seriaInfo: { $first: '$seriaInfo' },
							},
						},
						{ $sort: { updatedAt: -1 } },
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

		return res.status(200).json(logs[0])
	} catch (e) {
		return res.json(e)
	}
})

router.delete('/continueWatching/:id', verify.token, async (req, res) => {
	const logId = req.params.id

	try {
		await MoviePageLog.updateOne(
			{ _id: logId },
			{
				$set: {
					isDeletedFromContinueWathcing: true,
				},
			}
		)

		return resSuccess({
			res,
			alert: true,
			msg: 'Удалено из продолжить просмотр',
		})
	} catch (err) {
		return resError({ res, msg: err })
	}
})

router.get('/possibleYouLike', verify.token, async (req, res) => {
	const skip = +req.query.skip || 0
	const limit = +(req.query.limit > 0 && req.query.limit <= 20 ? req.query.limit : 20)

	const lookup = {
		from: 'movies',
		localField: 'movieId',
		foreignField: '_id',
		pipeline: [
			{
				$project: {
					name: true,
					genresAliases: true,
					categoryAlias: true,
				},
			},
		],
		as: 'movie',
	}

	try {
		const logs = await MoviePageLog.aggregate([
			{
				$facet: {
					// Список
					items: [
						{
							$match: {
								userId: req.user._id,
							},
						},
						{ $lookup: lookup },
						{
							$project: {
								userId: true,
								movieId: true,
								movie: true,
							},
						},
						{ $unwind: { path: '$movie' } },
						{
							$project: {
								genresAliases: '$movie.genresAliases',
							},
						},
						{ $unwind: { path: '$genresAliases' } },
						{
							$group: {
								_id: '$genresAliases',
								count: { $sum: 1 },
							},
						},
						{ $sort: { count: -1 } },
					],

					watchedMovieIds: [
						{
							$match: {
								userId: req.user._id,
							},
						},
						{ $group: { _id: null, ids: { $addToSet: '$movieId' } } },
					],
				},
			},
			{ $limit: 1 },
			{ $unwind: { path: '$watchedMovieIds', preserveNullAndEmptyArrays: true } },
			{
				$project: {
					genresWathingCount: '$items',
					watchedMovieIds: '$watchedMovieIds.ids',
				},
			},
		])

		const { watchedMovieIds, genresWathingCount } = logs[0]

		if (!watchedMovieIds || !genresWathingCount.length) {
			const mainAgregation = [
				...movieOperations({
					addToProject: {
						poster: { src: true },
						cover: { src: true },
						alias: true,
						_id: true,
					},
				}),
				{
					$lookup: {
						from: 'moviepagelogs',
						localField: '_id',
						foreignField: 'movieId',
						pipeline: [
							{
								$project: {
									_id: true,
									userId: true,
									movieId: true,
									videoId: true,
									updatedAt: true,
									endTime: true,
								},
							},
						],
						as: 'moviepagelog',
					},
				},
				{ $unwind: '$moviepagelog' },
				{
					$group: {
						_id: '$moviepagelog.videoId',
						count: { $sum: 1 },
						movieId: { $first: '$moviepagelog.movieId' },
						shortDesc: { $first: '$shortDesc' },
						name: { $first: '$name' },
						poster: { $first: '$poster' },
						cover: { $first: '$cover' },
						alias: { $first: '$alias' },
						duration: { $first: '$duration' },
						url: { $first: '$url' },
						dateReleased: { $first: '$dateReleased' },
						rating: { $first: '$rating' },
					},
				},
				{ $sort: { count: -1 } },
				{
					$group: {
						_id: '$movieId',
						videoId: { $first: '$_id' },
						count: { $first: '$count' },
						shortDesc: { $first: '$shortDesc' },
						poster: { $first: '$poster' },
						cover: { $first: '$cover' },
						name: { $first: '$name' },
						alias: { $first: '$alias' },
						count: { $first: '$count' },
						duration: { $first: '$duration' },
						url: { $first: '$url' },
						dateReleased: { $first: '$dateReleased' },
						rating: { $first: '$rating' },
					},
				},
				{
					$match: {
						count: { $gte: 10 },
					},
				},
			]

			const result = await Movie.aggregate([
				{
					$facet: {
						//Всего записей
						totalSize: [
							...mainAgregation,
							{
								$group: {
									_id: null,
									count: { $sum: 1 },
								},
							},
							{ $limit: 1 },
						],

						// Список
						items: [
							...mainAgregation,
							{ $sort: { count: -1 } },
							{ $project: { count: false } },
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
						url: '/collections/possibleYouLike',
						name: 'Возможно вам понравится',
					},
				},
			])

			return res.status(200).json(result[0])
		}

		const match = [
			{
				$match: {
					_id: { $nin: watchedMovieIds },
					publishedAt: { $ne: null },
				},
			},
			{
				$project: {
					duration: true,
					name: true,
					_id: true,
					poster: true,
					cover: true,
					rating: true,
					dateReleased: true,
					duration: true,
					pointsAmount: {
						$function: {
							body: function (genresWathingCount, genresAliases) {
								let pointsAmount = 0
								genresAliases.forEach((genre) => {
									const candidate = genresWathingCount.find((item) => item._id === genre)
									if (candidate) {
										pointsAmount += candidate.count
									}
								})
								return pointsAmount
							},
							args: [genresWathingCount, '$genresAliases'],
							lang: 'js',
						},
					},
					duration: {
						$switch: {
							branches: [
								{
									case: { $eq: ['$categoryAlias', 'films'] },
									then: {
										$sum: {
											$map: {
												input: '$films',
												as: 'item',
												in: '$$item.duration',
											},
										},
									},
								},
								{
									case: { $eq: ['$categoryAlias', 'serials'] },
									then: {
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
					url: { $concat: ['/p/', '$alias'] },
				},
			},
			{
				$match: {
					pointsAmount: { $gt: 0 },
				},
			},
		]

		const result = await Movie.aggregate([
			{
				$facet: {
					//Всего записей
					totalSize: [
						...match,
						{
							$group: {
								_id: null,
								count: { $sum: 1 },
							},
						},
						{ $limit: 1 },
					],

					// Список
					items: [
						...match,
						{ $sort: { pointsAmount: -1 } },
						{
							$project: {
								pointsAmount: false,
							},
						},
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
					url: '/collections/possibleYouLike',
					name: 'Возможно вам понравится',
				},
			},
		])

		return res.status(200).json(result[0])
	} catch (e) {
		return res.json(e)
	}
})

router.get('/popular', async (req, res) => {
	const skip = +req.query.skip || 0
	const limit = +(req.query.limit > 0 && req.query.limit <= 20 ? req.query.limit : 20)

	const mainAgregation = [
		...movieOperations({
			addToProject: {
				poster: { src: true },
				alias: true,
				_id: true,
			},
		}),
		{
			$lookup: {
				from: 'moviepagelogs',
				localField: '_id',
				foreignField: 'movieId',
				pipeline: [
					{
						$project: {
							_id: true,
							userId: true,
							movieId: true,
							videoId: true,
							updatedAt: true,
							endTime: true,
						},
					},
				],
				as: 'moviepagelog',
			},
		},
		{ $unwind: '$moviepagelog' },
		{
			$group: {
				_id: '$moviepagelog.videoId',
				count: { $sum: 1 },
				movieId: { $first: '$moviepagelog.movieId' },
				shortDesc: { $first: '$shortDesc' },
				name: { $first: '$name' },
				poster: { $first: '$poster' },
				alias: { $first: '$alias' },
				duration: { $first: '$duration' },
				url: { $first: '$url' },
				rating: { $first: '$rating' },
				dateReleased: { $first: '$dateReleased' },
			},
		},
		{ $sort: { count: -1 } },
		{
			$group: {
				_id: '$movieId',
				videoId: { $first: '$_id' },
				count: { $first: '$count' },
				shortDesc: { $first: '$shortDesc' },
				poster: { $first: '$poster' },
				name: { $first: '$name' },
				alias: { $first: '$alias' },
				count: { $first: '$count' },
				duration: { $first: '$duration' },
				url: { $first: '$url' },
				rating: { $first: '$rating' },
				dateReleased: { $first: '$dateReleased' },
			},
		},
		{
			$match: {
				count: { $gte: 10 },
			},
		},
	]

	try {
		const result = await Movie.aggregate([
			{
				$facet: {
					//Всего записей
					totalSize: [
						...mainAgregation,
						{
							$group: {
								_id: null,
								count: { $sum: 1 },
							},
						},
						{ $limit: 1 },
					],

					// Список
					items: [
						...mainAgregation,
						{ $sort: { count: -1 } },
						{ $project: { count: false } },
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
					name: 'Самые популярные',
					url: '/collections/popular',
				},
			},
		])
		return res.status(200).json(result[0])
	} catch (e) {
		return res.json(e)
	}
})

router.get('/carouselWithFavoritesAndBookmarks', verify.token, async (req, res) => {
	const skip = +req.query.skip || 0
	const limit = +(req.query.limit > 0 && req.query.limit <= 18 ? req.query.limit : 18)

	const mainAgregation = [
		...carousel,
		{
			$lookup: {
				from: 'moviefavorites',
				localField: '_id',
				foreignField: 'movieId',
				pipeline: [
					{
						$match: {
							userId: req.user._id,
						},
					},
				],
				as: 'favorite',
			},
		},
		{ $unwind: { path: '$favorite', preserveNullAndEmptyArrays: true } },
		{
			$lookup: {
				from: 'moviebookmarks',
				localField: '_id',
				foreignField: 'movieId',
				pipeline: [
					{
						$match: {
							userId: req.user._id,
						},
					},
				],
				as: 'bookmark',
			},
		},
		{ $unwind: { path: '$bookmark', preserveNullAndEmptyArrays: true } },
		{
			$addFields: {
				isFavorite: {
					$cond: {
						if: { $ifNull: ['$favorite', false] },
						then: '$favorite.isFavorite',
						else: false,
					},
				},
				isBookmark: {
					$cond: {
						if: { $ifNull: ['$bookmark', false] },
						then: '$bookmark.isBookmark',
						else: false,
					},
				},
			},
		},
		{
			$project: {
				bookmark: false,
				favorite: false,
				countPageViewed: false,
			},
		},
	]

	try {
		const result = await Movie.aggregate([
			{
				$facet: {
					//Всего записей
					totalSize: [
						...mainAgregation,
						{
							$group: {
								_id: null,
								count: { $sum: 1 },
							},
						},
						{ $limit: 1 },
					],

					// Список
					items: [...mainAgregation, { $skip: skip }, { $limit: limit }],
				},
			},
			{ $limit: 1 },
			{ $unwind: { path: '$totalSize', preserveNullAndEmptyArrays: true } },
			{
				$project: {
					totalSize: { $cond: ['$totalSize.count', '$totalSize.count', 0] },
					items: '$items',
					name: 'Карусель с закладками и избранными',
					url: '/collections/carouselWithFavoritesAndBookmarks',
				},
			},
		])
		return res.status(200).json(result[0])
	} catch (e) {
		return res.json(e)
	}
})

module.exports = router
