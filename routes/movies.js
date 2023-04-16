const express = require('express');
const router = express.Router();
const Movie = require('../models/movie');
const resError = require('../helpers/resError');
const verify = require('../middlewares/verify');
const movieRating = require('../models/movieRating');
const moviePageLog = require('../models/moviePageLog');
const movieFavorite = require('../models/movieFavorite');
const movieOperations = require('../helpers/movieOperations');

/*
 * Фильмы и сериалы
 */

// Получение списка записей
router.get('/', async (req, res) => {

	try {
		Movie.aggregate([
			{ $match: { publishedAt: { $ne: null } } },
			{ $lookup: {
					from: "categories",
					localField: "categoryAlias",
					foreignField: "alias",
					as: "category"
			} },
			{ $unwind: "$category" },
			{ $project: {
				alias: true,
				category: {
					aliasInUrl: true
				}
			} }
		], (err, result) => {

			return res.status(200).json( result );
		});

	} catch(err) {
		return resError({ res, msg: err });
	}
});

// Получение одной записи
router.get('/movie', async (req, res) => {
	const { _id, alias } = req.query;
	const find = _id ? { _id } : { alias };

	if(!find) return resError({ res, msg: 'Ожидается Id или Alias' });

	const videoParams = {
		_id: true,
		src: true,
		duration: true,
		qualities: true,
		thumbnail: true,
		thumbnails: true,
		previewSrc: true,
	}

	try {
		Movie.aggregate(
			movieOperations({
				addToMatch: {
					...find
				},
				addToProject: {
					_id: true,
					origName: true,
					fullDesc: true,
					shortDesc: true,
					countries: true,
					categoryAlias: true,
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
		async (err, result) => {
			if(err) return resError({ res, msg: err });
			if(!result[0]) return resError({ res, msg: 'Не найдено' });

			const data = result[0];

			if(data.badge && data.badge.finishAt && data.badge.finishAt < new Date()) {
				await Movie.updateOne(
					{ _id: data._id },
					{ $set: { badge: {} } }
				);

				delete(data.badge);
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

// Получить рейтинг поставленный пользователем
router.get('/rating', verify.token, async (req, res) => {

	const { movieId } = req.query;

	const rating = await movieRating.findOne({ 
		movieId: movieId,
		userId: req.user._id
	}, { 
		_id: false,
		rating: true 
	});

	return res.status(200).json( rating );
});

// Отправка рейтинга
router.post('/rating', verify.token, async (req, res) => {

	const {
		movieId,
		rating,
	} = req.body;

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

		const userRating = await movieRating.findOneAndUpdate(
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
			movieRating.create({ 
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

	const userFavorite = await movieFavorite.findOne(
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

		const userFavorite = await movieFavorite.findOne(
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

			await movieFavorite.updateOne(
				{ _id: userFavorite._id },
				{ 
					$set: { isFavorite },
					$inc: { '__v': 1 }
				}
			);
		
		} else {
			isFavorite = true;

			await movieFavorite.create({
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
		const logs = await moviePageLog.find({
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
	} = req.body;

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

	const logExists = await moviePageLog.findOne({ 
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
			await moviePageLog.updateOne(
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
			moviePageLog.create({
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