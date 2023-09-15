const express = require('express');
const router = express.Router();
const Movie = require('../models/movie');
const resError = require('../helpers/resError');
const verify = require('../middlewares/verify');
const MovieRating = require('../models/movieRating');
const MoviePageLog = require('../models/moviePageLog');
const MovieFavorite = require('../models/movieFavorite');
const MovieBookmark = require('../models/movieBookmark');
const movieOperations = require('../helpers/movieOperations');
const resSuccess = require('../helpers/resSuccess');

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

	const skipMovieRatings = +req.query.skipMovieRatings || 0
	const limitMovieRatings = +(req.query.limitMovieRatings > 0 && req.query.limitMovieRatings <= 100 ? req.query.limitMovieRatings : 100);

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
			{ "$facet": {
				// Всего записей
				"totalSizeReview": [
					...movieOperations({
						addToMatch: {
							...find
						},
						limit: 1
					}),
					{
						$lookup: {
							from: "movieratings",
							localField: "_id",
							foreignField: "movieId",
							pipeline: [
								{
									$match: {
										review: {$ne: null}
									}
								},
							],
							as: "reviews"
						}
					},
					{ $unwind: "$reviews" },
					{ $group: {
						_id: null,
						count: { $sum: 1 }
					} },
					{ $project: { _id: false } },
					{ $limit: 1 }
				],

				"item": [
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
							from: "movieratings",
							localField: "_id",
							foreignField: "movieId",
							pipeline: [
								{
									$match: {
										review: {$ne: null}
									}
								},
								{
									$project: {
										movieId:true,
										userId: true,
										rating: true,
										updatedAt: true,
										review: true,
									}
								},
								{
									$lookup: {
										from: "users",
										localField: "userId",
										foreignField: "_id",
										pipeline: [
											{
												$project: {
													firstname:true,
													lastname: true,
													displayName: true,
													avatar: true,
											}
											}
										],
										as: "user",
									},
								},
								{	$project: {
										userId: false,
										movieId:false
								}},
								{ $unwind: "$user" },
								{ $sort: {updatedAt:-1}},
								{ $skip: skipMovieRatings },
								{ $limit: limitMovieRatings},
							],
							as: "reviews"
						}
					},
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
								...movieOperations({
									addToProject: {
										_id: true,
										shortDesc: true,
										categoryAlias: true,
										genresAliases: true,
										logo: { src: true },
										poster: { src: true },
										genreNames: "$genres.name",
									},
								}),
								{ $project: {
									_id: true,
									name:true,
									genresAliases: true,
									rating: true,
									poster:true,
									alias:true,
									categoryAlias:true,
									genreNames:true,
									duration:true,
									badge:true,
									url:true,
									series:true,
									genresMatchAmount: {
										$size:[
											{	$setIntersection: ['$genresAliases', '$$selectedMovieGenresAliases']}
									]}
								}},
								{	$sort: { genresMatchAmount: -1	} },
								{ $limit: 20 },
								{ $project: {
										genresAliases:false,
										genresMatchAmount:false,
										categoryAlias:false
								}},
							],
							as: "similarItems"
						}
					}
				]
			} },
			{ $limit: 1 },
			{ $unwind: { path: "$totalSizeReview", preserveNullAndEmptyArrays: true } },
			{ $project: {
				totalSizeReview: { $cond: [ "$totalSizeReview.count", "$totalSizeReview.count", 0] },
				item: "$item"
			} },

		],
		async (err, result) => {
			if(err) return resError({ res, msg: err });
			if(!result[0]) return resError({ res, msg: 'Не найдено' });

			const data = result[0].item[0];
			data.reviews = {
				items: data.reviews,
				totalSize: result[0].totalSizeReview
			}

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

// Получить рейтинг и комментарий поставленный пользователем
router.get('/rating', verify.token, async (req, res) => {
	const { movieId,  subprofileId } = req.query;

	const rating = await MovieRating.findOne({
		movieId,
		userId: req.user._id,
		...(subprofileId? {subprofileId}: {subprofileId:null})
	}, {
		_id: false,
		rating: true,
		review: true
	});

	return res.status(200).json( rating );
});

// Отправка рейтинга и комментария
router.post('/rating', verify.token, async (req, res) => {
	let {
		movieId,
		rating,
		review,
		subprofileId
	} = req.body;

	if(!movieId) {
		return resError({
			res,
			alert: true,
			msg: 'Ожидается ID'
		});
	}

	movieId = mongoose.Types.ObjectId(movieId)

	if(typeof(rating)==='undefined' && typeof(review)==='undefined') {
		return resError({
			res,
			alert: true,
			msg: 'Ожидается rating и/или review'
		});
	}

	if(rating === null || (rating < 1 || rating > 10) || typeof rating === 'string' || rating === 0) {
		return resError({
			res,
			alert: true,
			msg: 'Оценка должна быть от 1 до 10'
		});
	}

	if(review && review.length>500) {
		return resError({
			res,
			alert: true,
			msg: 'Длина комментария не должна превышать 500'
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
				userId: req.user._id,
				...(subprofileId? {subprofileId}: {subprofileId:null})
			},
			{
				$set: {
					rating,
					review
				},
				$inc: { '__v': 1 }
			}
		);

		if(!userRating && !!rating) {
			await MovieRating.create({
				rating,
				review,
				movieId,
				userId: req.user._id,
				subprofileId
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

		const newMovieRating = movieRatingLogs[0].avg

		// Обновить среднюю оценку фильма
		await Movie.updateOne(
			{ _id: movieId },
			{ $set: { rating: newMovieRating } }
		);

		return res.status(200).json({
			success: true,
			movieId,
			rating,
			review
		});
	} catch(err) {
		return resError({ res, msg: err });
	}
});

// Удаление рейтинга и комментария
router.delete('/rating', verify.token, async (req, res) => {
	let {
		movieId,
	    subprofileId
	} = req.body;

	if(!movieId) {
		return resError({
			res,
			alert: true,
			msg: 'Ожидается Id'
		});
	}

	movieId = mongoose.Types.ObjectId(movieId)

	try {

		// Обнуление записи из БД
		 await MovieRating.findOneAndUpdate(
			{
				movieId,
				userId: req.user._id,
				...(subprofileId? {subprofileId}: {subprofileId:null})
			},
			{
				$set: {
					rating:null,
					review:null
				},
				$inc: { '__v': 1 }
			}
		);

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

		const newMovieRating = movieRatingLogs[0]?.avg || null

		// Обновить среднюю оценку фильма
		await Movie.updateOne(
			{ _id: movieId },
			{ $set: { rating: newMovieRating } }
		);

		return resSuccess({
			res,
			movieId,
			alert: true,
			msg: 'Успешно удалено'
		})

	} catch(err) {
		return resError({ res, msg: err });
	}
});

// Получение статуса на избранное
router.get('/favorite', verify.token, async (req, res) => {
	const { movieId, subprofileId } = req.query;

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
			userId: req.user._id,
			...(subprofileId? {subprofileId}: {subprofileId:null})
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

	const { movieId, subprofileId } = req.body;

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
				userId: req.user._id,
				...(subprofileId? {subprofileId}: {subprofileId:null})
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
				userId: req.user._id,
				subprofileId
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

// Получение статуса на закладки
router.get('/bookmark', verify.token, async (req, res) => {
	const { movieId, subprofileId } = req.query;

	const movie = await Movie.findOne({ _id: movieId }, { _id: true });

	if(!movie) {
		return resError({
			res,
			alert: true,
			msg: 'Страница не найдена'
		});
	}

	const userBookmark = await MovieBookmark.findOne(
		{
			movieId,
			userId: req.user._id,
			...(subprofileId? {subprofileId}: {subprofileId:null})
		},
		{
			_id: false,
			isBookmark: true
		}
	);

	const isBookmark = userBookmark ? userBookmark.isBookmark : false;

	return res.status(200).json({
		movieId,
		isBookmark
	});
});

// Добавление / удаление из закладок
router.post('/bookmark', verify.token, async (req, res) => {

	const { movieId, subprofileId } = req.body;

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

		let isBookmark;

		const userBookmark = await MovieBookmark.findOne(
			{
				movieId,
				userId: req.user._id,
				...(subprofileId? {subprofileId}: {subprofileId:null})
			},
			{
				_id: true,
				 isBookmark: true
			}
		);

		if(userBookmark) {
			isBookmark = !userBookmark.isBookmark;
			await MovieBookmark.updateOne(
				{ _id: userBookmark._id },
				{
					$set: { isBookmark },
					$inc: { '__v': 1 }
				}
			);

		} else {
			isBookmark = true;

			await MovieBookmark.create({
				movieId,
				isBookmark,
				userId: req.user._id,
				subprofileId
			});
		}

		return res.status(200).json({
			success: true,
			movieId,
			isBookmark
		});
	} catch(err) {
		return resError({ res, msg: err });
	}
});


// Получение логов просмотра фильма / серий сериала
router.get('/logs', verify.token, async (req, res) => {
	const { movieId, subprofileId } = req.query;

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
			userId: req.user._id,
			...(subprofileId? {subprofileId}: {subprofileId:null})
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
		subprofileId
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
		userId: req.user._id,
		...(subprofileId? {subprofileId}: {subprofileId:null})
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
					userId: req.user._id,
					...(subprofileId? {subprofileId}: {subprofileId:null})
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
				userId: req.user._id,
				...(subprofileId && {subprofileId})
			});
		}

		return res.status(200).json();
	} catch(err) {
		return resError({ res, msg: err });
	}
});

module.exports = router;
