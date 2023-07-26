const express = require('express');
const router = express.Router();
const Movie = require('../models/movie');
const Category = require('../models/category');
const resError = require('../helpers/resError');
const movieOperations = require('../helpers/movieOperations');
const MoviePageLog = require('../models/moviePageLog');

/*
 * Подборки и жанры для главной страницы
 */

router.get('/', async (req, res) => {
	const limit = +(req.query.limit >= 6 && req.query.limit <= 18 ? req.query.limit : 18);

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
		rating: '$rating.avg',
		categoryAlias: true,
		url: { $concat: [ "/p/", "$alias" ] },
	};

	try {
		const result = await Movie.aggregate([
			{ $facet: {
				
				"willPublishedSoon": [
					{ $match: { 
						willPublishedAt: { $gte: new Date() },
					} },
					{ $project: projectWillSoon },
				],

				//Случайные фильмы с рейтингом 7+
				"moviesWithRatingMore7": [
					{ $match: { 
							publishedAt: { $ne: null },
							rating: { avg: { $gte: 7 } }
					} },
					{ $unwind: { path: "$rating", preserveNullAndEmptyArrays: false } },
					{ $project: projectRatingMore7 },
					{$sample: {
						size:limit
					}}
				],

				// Карусель - самые популярные
				"carousel": [
					{ $lookup: {
						from: "moviepagelogs",
						localField: "_id",
						foreignField: "movieId",
						pipeline: [
							{ $match: {
								updatedAt: {
									$gte: new Date(new Date() - 3 * 60 * 60 * 24 * 1000)
								}
							} },
							{ $group: {
								_id: '$userId',
								items: {
									$push: '$$ROOT',
								}
							} },
							{ $project: {
								_id: true
							} }
						],
						as: "countPageViewed"
					} },
					...movieOperations({
						addToProject: {
							logo: true,
							cover: { src: true },
							genreName: { $first: "$genres.name" },
							countPageViewed: { $size: "$countPageViewed" },
						},
						sort: { countPageViewed: -1, raisedUpAt: -1, publishedAt: -1 },
						limit: limit
					}),
					{ $project: {
						countPageViewed: false
					} }
				],

				// Новинки
				"new": [
					...movieOperations({
						addToProject: {
							poster: { src: true }
						},
						sort: { raisedUpAt: -1, createdAt: -1 },
						limit: limit
					}),
					{ $project: {
						genres: false,
						ageLevel: false,
						dateReleased: false,
						categoryAlias: false,
					} }
				],

				// Жанры
				"genres": [
					{ $lookup: {
						from: "moviepagelogs",
						localField: "_id",
						foreignField: "movieId",
						pipeline: [
							{ $match: {
								updatedAt: {
									$gte: new Date(new Date() - 5 * 60 * 60 * 24 * 1000)
								}
							} },
							{ $group: {
								_id: '$userId',
								items: {
									$push: '$$ROOT',
								}
							} },
							{ $project: {
								_id: true
							} }
						],
						as: "countPageViewed"
					} },
					...movieOperations({
						addToProject: {
							poster: { src: true },
							genres: { $first: "$genres" },
							countPageViewed: { $size: "$countPageViewed" },
						},
						sort: { raisedUpAt: -1, publishedAt: -1 },
					}),
					{ $unwind: { path: "$genres" } },
					{ $group: {
							_id: '$genres',
							items: {
								$push: '$$ROOT',
							},
							countPageViewed: { $sum: "$countPageViewed" },
						}
					},
					{ $sort: { countPageViewed: -1 } },
					{ $project: {
						_id: false,
						name: "$_id.name",
						items: "$items",
						url: { $concat: [ "/collections/", "$_id.alias" ] },
					} },
					{ $project: {
						items: {
							genres: false,
							ageLevel: false,
							dateReleased: false,
							categoryAlias: false,
							countPageViewed: false
						}
					} }
				]
			} },
			{ $project: {
				collections: [
					{
						type: "carousel",
						items: "$carousel"
					},
					{
						name: "Новинки",
						type: "new",
						items: "$new"
					},
					{
						name:"Cкоро на сервисе",
						type: "willPublishedSoon",
						items: '$willPublishedSoon',
						url:'/collections/willPublishedSoon'
					},
					{
						name:"Cлучайныe фильмы с рейтингом 7+",
						type: "randomMoviesWithRatingMore7",
						items: '$moviesWithRatingMore7',
					}
				],
				genres: "$genres",
			} },
		]);
	
		collections = [
			...result[0]['collections'],
			...result[0]['genres'],
		]
	
		const collectionsFiltered = collections
									.filter(collection => collection.items.length >= 6||collection.type==='randomMoviesWithRatingMore7' || collection.type==='willPublishedSoon')
									.map(collection => ({
										...collection,
										items: collection.items.slice(0, limit)
									}));

		return res.status(200).json(collectionsFiltered);

	} catch(err) {
		return resError({ res, msg: err });
	}
});

// Получение коллекции топ-10 просмотров за неделю
router.get('/top10', async (req, res) => {

	const today = new Date()
	const year = today.getFullYear()
	const month = today.getMonth()
	const day = today.getDate()
	const dateWeekAgo = new Date(year, month, day - 7)

	try {
		const result = await MoviePageLog.aggregate([
			{ $match: {
					updatedAt: {
						$gte: dateWeekAgo
					}
			}},
			{ $group: { 
				_id: '$videoId',
				count: { $sum: 1 },
				movieId: {
					$addToSet: "$movieId"
				},
			} },
			{ $sort: {count:-1}},
			{ $group: {
				_id: '$movieId',         
				videoId:  { $first: '$_id' },          
				count: { $first: '$count' },
			}},
			{ $sort: {count:-1}},
			{ $lookup: {
					from: "movies",
					localField: "_id",
					foreignField: "_id",
					pipeline: [
						{ $project: {
							_id: true,
							name: true,
							alias:true,
							shortDesc:true,
							poster: true,
						} },
						{ $limit: 1 }
					],
					as: "movie"
			}},
			{ $unwind: { path: "$movie" } },
			{ $limit: 10 },
			{ $project: {
				_id: false,
				viewsAmount:'$count',
				movie:true
			}}
		])

		return res.status(200).json(result);

	} catch(err) {
		return resError({ res, msg: err });
	}
});

module.exports = router;