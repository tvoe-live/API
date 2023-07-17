const express = require('express');
const router = express.Router();
const Movie = require('../models/movie');
const resError = require('../helpers/resError');
const movieOperations = require('../helpers/movieOperations');
const getCatalogPages = require('../helpers/getCatalogPages');

/*
 * Фильмы / сериалы с фильтром
 */


// Страницы для рендеринга при сборке
router.get('/pages', async (req, res) => {
	const { categoryAlias, showGenreName } = req.query;

	try {
		const result = await getCatalogPages({
			categoryAlias,
			showGenreName
		});

		return res.status(200).json(result);
	} catch (error) {
		return res.json(error);
	}
});


// Каталог в фильмах и сериалах
router.get('/', async (req, res) => {
	const {
		sort,
		rating,
		genreAlias,
		dateReleased,
		categoryAlias,
	} = req.query;

	let sortParams = { raisedUpAt: -1, createdAt: -1 }; // Параметры сортировки
	let matchRating = rating ? { rating: { $gte: +rating } } : {}; // Поиск по рейтингу >=

	const skip = +req.query.skip || 0
	const limit = +(req.query.limit > 0 && req.query.limit <= 100 ? req.query.limit : 100)

	if(!categoryAlias) return resError({ res,  msg: 'Ожидается categoryAlias' });

	// Установление сортировки списка
	if(sort)
		switch(sort) {
			case 'new': sortParams = { dateReleased: -1 }; break;
			case 'rating': sortParams = { rating: -1, raisedUpAt: -1, createdAt: -1 }; break;
			default: return resError({ res,  msg: 'Неверный sort' });
		}

	try {
		const pages = await getCatalogPages({ categoryAlias });
		const page = pages.find(page => 
			page.genreAlias === genreAlias &&
			page.dateReleased === dateReleased &&
			page.categoryAlias === categoryAlias
		);

		if(!page) return resError({ res,  msg: 'Страницы не существует' });

		delete page.genreName;

		// Объединение жанров из фильмов и сериалов
		if(page.categoryAlias === 'collections') {
			page.categoryAlias = { $in: [ 'films', 'serials' ] }
		}

		// Переименовать поле genreAlias в genresAliases для поиска в бд
		if(page.genreAlias) 
			page.genresAliases = page.genreAlias;
			delete page.genreAlias;

		// Привести в вид поиска по строке /dateReleased/
		if(page.dateReleased) page.dateReleased = new RegExp(page.dateReleased);

		const result = await Movie.aggregate([
			{ "$facet": {
				// Всего записей
				"totalSize": [
					{ $lookup: {
						from: "movieratings",
						localField: "_id",
						foreignField: "movieId",
						pipeline: [
							{ $match: matchRating },
							{ $group: { 
								_id: null,
								avg: { $avg: "$rating" } 
							} }
						],
						as: "rating"
					} },
					{ $unwind: { path: "$rating" } },
					{ $match: { 
						...page,
						publishedAt: { $ne: null }
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
					...movieOperations({
						addToMatch: page,
						addToProject: {
							poster: { src: true }
						},
						sort: sortParams,
						matchRating
					}),
					{ $skip: skip },
					{ $limit: limit }
				]
			} },
			{ $limit: 1 },
			{ $unwind: { path: "$genre", preserveNullAndEmptyArrays: true } },
			{ $unwind: { path: "$totalSize", preserveNullAndEmptyArrays: true } },
			{ $project: {
				totalSize: { $cond: [ "$totalSize.count", "$totalSize.count", 0] },
				items: "$items"
			} },
		]);

		return res.status(200).json(result[0]);

	} catch(err) {
		return resError({ res, msg: err });
	}
});

module.exports = router;