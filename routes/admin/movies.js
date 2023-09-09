const express = require('express');
const router = express.Router();
const mongoose = require('mongoose');
const Movie = require('../../models/movie');
const verify = require('../../middlewares/verify');
const resError = require('../../helpers/resError');
const resSuccess = require('../../helpers/resSuccess');
const getSearchQuery = require('../../middlewares/getSearchQuery');
const schedule = require('node-schedule')

/*
 * Админ-панель > Фильмы и сериалы
 */

/*
 * Получение списка записей
 */
router.get('/', verify.token, verify.isManager, getSearchQuery, async (req, res) => {
	const skip = +req.query.skip || 0
	const limit = +(req.query.limit > 0 && req.query.limit <= 100 ? req.query.limit : 100)

	const searchMatch = req.RegExpQuery && {
		name: req.RegExpQuery
	};

	try {
		const result = await Movie.aggregate([
			{ "$facet": {
				// Всего записей
				"totalSize": [
					{ $match: {
						...searchMatch,
					} },
					{ $group: {
						_id: null,
						count: { $sum: 1 }
					} },
					{ $project: { _id: false } },
					{ $limit: 1 }
				],
				// Опубликованные
				"totalSizePublished": [
					{ $match: {
						...searchMatch,
						publishedAt: { $ne: null },
					} },
					{ $group: {
						_id: null,
						count: { $sum: 1 }
					} },
					{ $project: { _id: false } },
					{ $limit: 1 }
				],
				// Не опубликованные
				"totalSizeUnpublished": [
					{ $match: {
						...searchMatch,
						publishedAt: null,
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
						...searchMatch
					} },
					{ $project: { __v: false } },
					{ $sort : { raisedUpAt: -1, _id : -1 } },
					{ $skip: skip },
					{ $limit: limit }
				]

			} },
			{ $limit: 1 },
			{ $unwind: { path: "$totalSize", preserveNullAndEmptyArrays: true } },
			{ $unwind: { path: "$totalSizePublished", preserveNullAndEmptyArrays: true } },
			{ $unwind: { path: "$totalSizeUnpublished", preserveNullAndEmptyArrays: true } },
			{ $project: {
				totalSize: { $cond: [ "$totalSize.count", "$totalSize.count", 0] },
				totalSizePublished: { $cond: [ "$totalSizePublished.count", "$totalSizePublished.count", 0] },
				totalSizeUnpublished: { $cond: [ "$totalSizeUnpublished.count", "$totalSizeUnpublished.count", 0] },
				items: "$items"
			} },
		]);

		return res.status(200).json(result[0]);

	} catch(err) {
		return resError({ res, msg: err });
	}
});

/*
 * Получение одной записи
 */
router.get('/movie', verify.token, verify.isManager, async (req, res) => {

	const { _id } = req.query;

	try {
		const movie = await Movie.findOne({ _id });

		return res.status(200).json( movie );
	} catch(err) {
		return resError({ res, msg: err });
	}
});


/*
 * Добавление / редактирование записей
 */
router.post('/', verify.token, verify.isManager, async (req, res) => {

	const {
		_id,
		name,
		origName,
		shortDesc,
		fullDesc,
		alias,
		badge,
		ageLevel,
		dateReleased,
		countries,
		categoryAlias,
		genresAliases,
		persons,
	} = req.body;

	let data = {
		name,
		origName,
		shortDesc,
		fullDesc,
		alias,
		badge,
		ageLevel,
		dateReleased,
		countries,
		categoryAlias,
		genresAliases,
		persons
	};

	try {
		let movie;

		if(_id) {
			// При изменении бейджа поднять медиа страницу во всех списках
			if(badge && badge.finishAt) {
				await Movie.updateOne(
					{ _id },
					{ $set: {
						raisedUpAt: new Date()
					} }
				);

				schedule.scheduleJob(new Date(badge.finishAt), async function() {
					await Movie.updateOne(
						{ _id, },
						{ $set: { badge: {} } }
					);
				});
			}

			if(categoryAlias) {
				movie = await Movie.findOne({ _id }, {
					films: true,
					series: true,
					categoryAlias: true
				})

				if(categoryAlias === 'serials' && (movie.films && movie.films.length)) {
					return resError({
						res,
						alert: true,
						msg: 'Необходимо удалить фильм'
					});
				}

				if(categoryAlias === 'films' && (movie.series && movie.series.length)) {
					return resError({
						res,
						alert: true,
						msg: 'Необходимо удалить серии'
					});
				}
			}

			if(alias){
				const existMovie = await Movie.findOne({ _id:{$ne:_id}, alias })
				if(existMovie){
					return resError({
						res,
						alert: true,
						msg: 'Фильм с таким alias уже существует'
					})
				}
			}

			movie = await Movie.findOneAndUpdate({ _id }, { $set: data }, { new: true })
		} else {

			if(alias){
				const existMovie = await Movie.findOne({alias })
				if(existMovie){
					return resError({
						res,
						alert: true,
						msg: 'Фильм с таким alias уже существует'
					})
				}
			}

			movie = await Movie.create({
				...data,
				raisedUpAt: new Date(),
				creatorUserId: req.user._id
			});
		}

		return resSuccess({
			res,
			...data,
			alert: true,
			_id: movie._id,
			msg: 'Успешно сохранено'
		})
	} catch (error) {
		return res.json(error);
	}
});

/*
 * Опубликовать / снять с публикации запись
 */
router.put('/publish', verify.token, verify.isManager, async (req, res) => {

	const { _id } = req.body;

	if(!_id) {
		return resError({
			res,
			alert: true,
			msg: 'Не получен _id'
		});
	}

	try {
		const movie = await Movie.findOne({ _id });


		if (!movie.publishedAt){ // Снять фильм с публикации можно всегда. Опубликовать фильм - только если заполнены обязательные поля

			if(!movie.name) {
				return resError({
					res,
					alert: true,
					msg: 'Необходимо название'
				});
			}

			if(!movie.alias) {
				return resError({
					res,
					alert: true,
					msg: 'Необходим ЧПУ-адрес'
				})
			}

			if(!movie.categoryAlias) {
				return resError({
					res,
					alert: true,
					msg: 'Необходима категория'
				});
			}

			if(!movie.genresAliases || !movie.genresAliases.length) {
				return resError({
					res,
					alert: true,
					msg: 'Необходимы жанры'
				});
			}

			const existMovies = await Movie.find({alias:movie.alias, publishedAt:{$ne:null} })
			if (existMovies.length){
				return resError({
					res,
					alert: true,
					msg: `Фильм с ЧПУ-адресом ${movie.alias} уже существует`
				});
			}
		}

		const set = {
			publishedAt: !movie.publishedAt ? new Date() : null
		};

		await Movie.updateOne(
			{ _id },
			{ $set: set }
		);

		return resSuccess({
			_id,
			res,
			...set,
			alert: true,
			msg: 'Успешно опубликовано'
		})
	} catch(err) {
		return resError({ res, msg: err });
	}
});

/*
 * Поднять медиа страницу во всех списках
 */
router.put('/raiseUp', verify.token, verify.isManager, async (req, res) => {
	try {
		const { _id } = req.body;

		if(!_id) {
			return resError({
				res,
				alert: true,
				msg: 'Не получен _id'
			});
		}

		const set = {
			raisedUpAt: new Date()
		}

		await Movie.updateOne(
			{ _id },
			{ $set: set }
		);

		return resSuccess({
			_id,
			res,
			...set,
			alert: true,
			msg: 'Успешное поднятие'
		})
	} catch(err) {
		return resError({ res, msg: err });
	}
});

module.exports = router;
