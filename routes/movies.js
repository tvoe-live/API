const express = require('express');
const router = express.Router();
const Movie = require('../models/movie');
const resError = require('../helpers/resError');
const verify = require('../middlewares/verify');
const MovieRating = require('../models/movieRating');
const MoviePageLog = require('../models/moviePageLog');
const MovieFavorite = require('../models/movieFavorite');
const movieOperations = require('../helpers/movieOperations');
const mongoose = require('mongoose');

/*
 * Фильмы и сериалы
 */

router.get('/', async (req, res) => {
	const skip = +req.query.skip || 0
	const limit = +(req.query.limit > 0 && req.query.limit <= 100 ? req.query.limit : 100)

	const agregationListForTotalSize = [
		{ $match: { publishedAt: { $ne: null } } },
		{ $lookup: 	
			{
				from: "categories",
				localField: "categoryAlias",
				foreignField: "alias",
				as: "category"
			} 
		},
		{ $unwind: "$category" },
	]

	try {
		Movie.aggregate([
			{
				"$facet":{
					// Всего записей
					"totalSize":[
						...agregationListForTotalSize,
						{ $group: { 
							_id: null, 
							count: { $sum: 1 }
						} },
						{ $project: { _id: false } },
						{ $limit: 1 }
					],
					"items":[
						...agregationListForTotalSize,
						{ $project: {
							alias: true,
							category: {
								aliasInUrl: true
							}
						} },
						{ $skip: skip },
						{ $limit: limit },
					]
				}
			},
			{ $unwind: { path: "$totalSize", preserveNullAndEmptyArrays: true } },
			{ $project: {
				totalSize: { $cond: [ "$totalSize.count", "$totalSize.count", 0] },
				items: "$items"
			} },
		], (err, result) => {
			return res.status(200).json( result[0] );
		});

	} catch(err) {
		return resError({ res, msg: err });
	}
});

// Получение одной записи
router.get('/movie', async (req, res) => {
	const { _id, alias } = req.query;
	const find = _id ? { _id: mongoose.Types.ObjectId(_id) } : { alias };

	if(!find) return resError({ res, msg: 'Ожидается Id или Alias' });

	const videoParams = {
		_id: true,
		src: true,
		thumbnail: true,
		version: true,
		duration: true,
		qualities: true,
		audio: true,
		subtitles: true,
		status: true
	}

	try {
		Movie.aggregate([
			...movieOperations({
				addToMatch: {
					...find
				},
				addToProject: {
					_id: true,
					rating: true,
					origName: true,
					fullDesc: true,
					shortDesc: true,
					countries: true,
					categoryAlias: true,
					genresAliases: true,
					logo: { src: true },
					cover: { src: true },
					poster: { src: true },
					genreNames: "$genres.name",
					persons: { 
						name: true,
						type: true
					},
					trailer: videoParams,
					films: videoParams,
					series: videoParams
				},
				limit: 1
			}),
			{
				$lookup: {
					from: "movies",
					let: {
						selectedMovieGenresAliases: "$genresAliases",			
						selectedMovieId: "$_id",
						selectedMovieCategoryAlias: "$categoryAlias"
					},
					pipeline: [
						{ $match: {
								publishedAt: {$ne:null},
								$expr: {
									$and:[
										{$ne: ["$_id", "$$selectedMovieId"]},
										{$eq: ['$categoryAlias', '$$selectedMovieCategoryAlias']},
										{$gte: [ 
											{ $size:[
												{	$setIntersection: ['$genresAliases', '$$selectedMovieGenresAliases']}
											]},
											1
										]}
									]
								}
							},
						},
						{$project: {
							_id: true,
							name:true,
							genresAliases: true,
							poster:true,
							alias:true,
							genresMatchAmount: {
								$size:[
									{	$setIntersection: ['$genresAliases', '$$selectedMovieGenresAliases']}
							]}
						}}, 
						{	$sort: { genresMatchAmount: -1	} },
						{ $limit: 20 }
					],
					as: "similarItems"
				}
			} 
		],
		async (err, result) => {
			if(err) return resError({ res, msg: err });
			if(!result[0]) return resError({ res, msg: 'Не найдено' });

			const data = result[0];

			switch(data.categoryAlias) {
				case 'films': data.sources = data.films[0] || null; break;
				case 'serials': data.sources = data.series || null; break;
				default: break;
			}

			delete(data.films);
			delete(data.series);

			return res.status(200).json(data);

		});

	} catch(err) {
		return resError({ res, msg: err });
	}
});

// Получить рейтинг поставленный пользователем
router.get('/rating', verify.token, async (req, res) => {

	const { movieId } = req.query;

	const rating = await MovieRating.findOne({ 
		movieId,
		userId: req.user._id
	}, { 
		_id: false,
		rating: true 
	});

	return res.status(200).json( rating );
});

// Отправка рейтинга
router.post('/rating', verify.token, async (req, res) => {
	let {
		movieId,
		rating,
	} = req.body;

	movieId = mongoose.Types.ObjectId(movieId)

	if(!movieId) {
		return resError({
			res, 
			alert: true,
			msg: 'Ожидается ID'
		});
	}
	if((rating !== null && (rating < 1 || rating > 10)) || typeof rating === 'string' || rating === 0) {
		return resError({
			res, 
			alert: true,
			msg: 'Оценка должна быть от 1 до 10'
		});
	}

	try {
		const movie = await Movie.findOne({ _id: movieId }, { _id: true });

		if(!movie) {
			return resError({
				res, 
				alert: true,
				msg: 'Страница не найдена'
			});
		}

		const userRating = await MovieRating.findOneAndUpdate(
			{ 
				movieId,
				userId: req.user._id
			},
			{ 
				$set: { rating },
				$inc: { '__v': 1 }
			}
		);

		if(!userRating && rating !== null) {
			await MovieRating.create({ 
				rating,
				movieId,
				userId: req.user._id,
			});
		} else if(!userRating) {
			return resError({
				res, 
				alert: true,
				msg: 'Необходимо оценить перед сбросом оценки'
			});
		}

		// Получить все оценки фильма
		const movieRatingLogs = await MovieRating.aggregate([
			{ $match: {
				movieId
			} },
			{ $group: { 
				_id: null,
				avg: { $avg: "$rating" } 
			} },
			{ $project: {
				_id: false,
				avg: true
			} }
		]);

		const newMovieRating = movieRatingLogs[0].avg || 0

		// Обновить среднюю оценку фильма
		await Movie.updateOne(
			{ _id: movieId },
			{ $set: { rating: newMovieRating } }
		);

		return res.status(200).json({
			success: true,
			movieId,
			rating
		});
	} catch(err) {
		return resError({ res, msg: err });
	}
});

// Получение статуса на избранное
router.get('/favorite', verify.token, async (req, res) => {
	const { movieId } = req.query;

	const movie = await Movie.findOne({ _id: movieId }, { _id: true });

	if(!movie) {
		return resError({
			res, 
			alert: true,
			msg: 'Страница не найдена'
		});
	}

	const userFavorite = await MovieFavorite.findOne(
		{ 
			movieId,
			userId: req.user._id
		}, 
		{ 
			_id: false, 
			isFavorite: true
		}
	);

	const isFavorite = userFavorite ? userFavorite.isFavorite : false;

	return res.status(200).json({
		movieId,
		isFavorite
	});
});

// Добавление / удаление из избранного
router.post('/favorite', verify.token, async (req, res) => {

	const { movieId } = req.body;

	if(!movieId) {
		return resError({
			res, 
			alert: true,
			msg: 'Ожидается ID'
		});
	}

	try {
		const movie = await Movie.findOne({ _id: movieId }, { _id: true });

		if(!movie) {
			return resError({
				res, 
				alert: true,
				msg: 'Страница не найдена'
			});
		}


		let isFavorite;

		const userFavorite = await MovieFavorite.findOne(
			{ 
				movieId,
				userId: req.user._id
			}, 
			{ 
				_id: true, 
				isFavorite: true
			}
		);

		if(userFavorite) {
			isFavorite = !userFavorite.isFavorite;

			await MovieFavorite.updateOne(
				{ _id: userFavorite._id },
				{ 
					$set: { isFavorite },
					$inc: { '__v': 1 }
				}
			);
		
		} else {
			isFavorite = true;

			await MovieFavorite.create({
				movieId,
				isFavorite,
				userId: req.user._id
			});
		}
	

		return res.status(200).json({
			success: true,
			movieId,
			isFavorite
		});
	} catch(err) {
		return resError({ res, msg: err });
	}
});

// Получение логов просмотра фильма / серий сериала
router.get('/logs', verify.token, async (req, res) => {
	const { movieId } = req.query;

	if(!movieId) {
		return resError({
			res, 
			alert: true,
			msg: 'Не передан movieId'
		});
	}

	try {
		const logs = await MoviePageLog.find({
			movieId,
			userId: req.user._id
		}, { 
			_id: false,
			videoId: true,
			endTime: true,
			updatedAt: true
		}).sort({ updatedAt: -1 });

		return res.status(200).json(logs);
	} catch(err) {
		return resError({ res, msg: err });
	}
});

// Добавление записи просмотра фильма / серий сериала в логи
router.post('/addLog', verify.token, async (req, res) => {

	const { 
		movieId,
		referer,
		videoId,
		endTime,
		startTime,
		action,
	} = req.body;

	// action == 'new': открытие видео
	// action == 'exit': закрытие видео
	// action == 'watch': просмотр видео (раз в минуту)

	if(!movieId) return resError({ res, msg: 'Не передан movieId' });
	if(!videoId) return resError({ res, msg: 'Не передан videoId' });
	if(req.useragent.isBot) return resError({ res, msg: 'Обнаружен бот' });

	const movie = await Movie.findOne({ _id: movieId }, { _id: true });

	if(!movie) {
		return resError({
			res, 
			alert: true,
			msg: 'Страница не найдена'
		});
	}

	const logExists = await MoviePageLog.findOne({ 
		videoId, 
		userId: req.user._id
	}, { _id: true });

	const device = {
		ip: req.ip,
		os: req.useragent.os,
		isBot: req.useragent.isBot,
		isMobile: req.useragent.isMobile,
		isDesktop: req.useragent.isDesktop,
		browser: req.useragent.browser,
		version: req.useragent.version,
		platform: req.useragent.platform,
	}

	try {
		if(logExists) {
			await MoviePageLog.updateOne(
				{ 
					videoId,
					userId: req.user._id
				},
				{ 
					$set: {
						device,
						endTime,
						startTime,
					},
					$inc: { '__v': 1 }
				}
			);
		} else {
			MoviePageLog.create({
				device,
				movieId,
				referer,
				videoId,
				endTime,
				startTime,
				userId: req.user._id
			});
		}

		return res.status(200).json();
	} catch(err) {
		return resError({ res, msg: err });
	}
});

module.exports = router;