const express = require('express');
const router = express.Router();
const Movie = require('../models/movie');
const Category = require('../models/category');
const resError = require('../helpers/resError');
const movieOperations = require('../helpers/movieOperations');
const verify = require('../middlewares/verify');
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

	const today = new Date()
	const year = today.getFullYear()
	const month = today.getMonth()
	const day = today.getDate()
	const dateWeekAgo = new Date(year, month, day - 7)

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

				//Топ 10 фильмов по просмотрам за неделю
				"top10": [
					{ $project: {
						_id: true,
						name: true,
						alias:true,
						shortDesc:true,
						poster: true,
					} },
					{ $lookup: {
						from: "moviepagelogs",
						localField: "_id",
						foreignField: "movieId",
						pipeline: [
							{ $project: {
								_id: true,
								userId: true,
								movieId:true,
								videoId:true,
								updatedAt:true,
								endTime:true
							} },
						],
						as: "moviepagelog"
					}},
					{ $unwind: '$moviepagelog'},
					{ $match: {
						'moviepagelog.updatedAt': {
						$gte: dateWeekAgo
					}}},
					{ $group: { 
						_id: '$moviepagelog.videoId',
						count: { $sum: 1 },
						movieId: { $first: "$moviepagelog.movieId" },
						shortDesc: { $first: "$shortDesc" },
						name: { $first: "$name" },
						poster: { $first: "$poster" },
						alias: { $first: "$alias" },
					} },
					{ $sort: {count:-1}},
					{ $group: {
						_id: '$movieId',         
						videoId:  { $first: '$_id' },          
						count: { $first: '$count' },
						shortDesc: { $first: '$shortDesc' },
						name: { $first: '$name' },
						alias: { $first: '$alias' },
						count: { $first: '$count' },
					}},
					{ $sort: {count:-1}},
					{ $limit: 10 },
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
					},
					{
						name:"Топ 10 фильмов по просмотрам за неделю",
						type: "top10",
						items: '$top10',
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

router.get('/continueWatching', verify.token, async (req, res) => {

	const skip = +req.query.skip || 0
	const limit = +(req.query.limit > 0 && req.query.limit <= 20 ? req.query.limit : 20);

	const titlesDuration =  10*60
	
	const lookup = {
		from: "movies",
		localField: "movieId",
		foreignField: "_id",
		pipeline: [
			{ $project: {
					name: true,
					alias:true,
					series:true,
					categoryAlias:true,
					films:{
						duration:true
					},
					poster: {
						src: true
					},
				},
		 	},
			{ $unwind: { path: "$films", preserveNullAndEmptyArrays: true }}
		],
		as: "movie"
	};

	const project = {
		_id: true,
		videoId: true,
		movieId: true,
		endTime: true,
		updatedAt: true,
		movie: {
			name: '$movie.name',
			alias: '$movie.alias',
			categoryAlias: '$movie.categoryAlias',
			filmDuration:"$movie.films.duration",
			poster: '$movie.poster',
		},
		seriaInfo: {
			$function:
			{
				body: function(seasons, videoId) {
					if (!seasons.length) return null

					for (let i=0; i<seasons.length; i++){
						const season = seasons[i]

						for (let j=0; j<season.length; j++){
							const episode = season[j]
							if (String(episode._id) === String(videoId)){
								return {
									season: i+1,
									episode: j+1,
									seriaDuration: episode.duration
								}
							}
						}
					}
				 },
				 args: [ "$movie.series",  "$videoId"],
				 lang: "js"
			 }
		},	
	}

	const match = {
		$or: [
			{
				$expr: {
					$gte: ["$seriaInfo.seriaDuration", { $sum:["$endTime", titlesDuration]} ] // Длительность СЕРИИ должна быть больше чем время окончания просмотра + титры ( если пользователь досмотрел серию до конца, то он не будет отображаться в разделе продолжить просмотр)
				}
			},
			{
				$expr:{
					$gte: ["$movie.filmDuration", { $sum:["$endTime", titlesDuration]} ] // Длительность ФИЛЬМА должна быть больше чем время окончания просмотра + титры ( если пользователь досмотрел фильм до конца, то он не будет отображаться в разделе продолжить просмотр)
				}
			}
		]
	}

	try {

		const logs = await MoviePageLog.aggregate([

			{
				"$facet": {
					//Всего записей
					"totalSize": [
						{ $match: { 
							userId: req.user._id
						} },
						{ $lookup: lookup },
						{ $unwind: { path: "$movie" } },
						{ $project: project},
						{ $match: match	},
						{ $group: { 
							_id: null, 
							count: { $sum: 1 }
						} },
						{ $project: { _id: false } },
						{ $limit: 1 }
					],
					// Список
					"items":[
						{ $match: { 
							userId: req.user._id
						} },
						{ $lookup: lookup },
						{ $unwind: { path: "$movie" } },
						{ $project: project},
						{ $match: match	},
						{ $sort : { updatedAt: -1} },
						{ $skip: skip },
						{ $limit: limit },
					]
				}
			},
			{ $limit: 1 },
			{ $unwind: { path: "$totalSize", preserveNullAndEmptyArrays: true } },
			{ $project: {
				totalSize: { $cond: [ "$totalSize.count", "$totalSize.count", 0] },
				items: "$items"
			} },
		]);
		
		return res.status(200).json(logs[0])
	} catch(e){
		return res.json(e);
	}
});

module.exports = router;