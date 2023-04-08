const express = require('express');
const router = express.Router();
const mongoose = require('mongoose');
const Movie = require('../../models/movie');
const verify = require('../../middlewares/verify');
const resError = require('../../helpers/resError');
const resSuccess = require('../../helpers/resSuccess');
const getSearchQuery = require('../../middlewares/getSearchQuery');

/*
 * Админ-панель > Фильмы и сериалы
 */

/*
 * Получение списка записей
 */
router.get('/', verify.token, verify.isManager, getSearchQuery, async (req, res) => {
	const cursorId = mongoose.Types.ObjectId(req.query.cursorId);
	const limit = +(req.query.limit > 0 && req.query.limit <= 100 ? req.query.limit : 100);

	const cursorMatch = req.query.cursorId ? { 
		_id: { $lt: cursorId } 
	} : null;

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
						...searchMatch,
						...cursorMatch,
					} },
					{ $project: { __v: false } },
					{ $sort : { _id : -1 } },
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
			
			movie = await Movie.findOneAndUpdate({ _id }, { $set: data }, { new: true })
		} else {
			movie = await Movie.create({
				...data,
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

	try {
		const movie = await Movie.findOne({ _id });

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
			});
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

module.exports = router;