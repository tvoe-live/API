const express = require('express');
const router = express.Router();
const Movie = require('../models/movie');
const resError = require('../helpers/resError');
const Category = require('../models/category');
const movieOperations = require('../helpers/movieOperations');

/*
 * Получение всех категорий и жанров
 */

router.get('/', async (req, res) => {
	const { categoryAliasInUrl } = req.query;

	if(!categoryAliasInUrl) return resError({ res,  msg: 'Ожидается categoryAliasInUrl' });

	let categoryAlias;

	switch(categoryAliasInUrl) {
		case 'filmy': categoryAlias = 'films'; break;
		case 'serialy': categoryAlias = 'serials'; break;
		default: break;
	}

	try {
		const result = await Movie.aggregate([
			{ $facet: {
				// Новинки
				"new": [
					...movieOperations({
						addToMatch: {
							categoryAlias: categoryAlias
						},
						addToProject: {
							poster: { src: true }
						},
						limit: 24
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
						addToMatch: {
							categoryAlias: categoryAlias
						},
						addToProject: {
							genres: true,
							poster: { src: true },
							countPageViewed: { $size: "$countPageViewed" },
						},
					}),
					{ $unwind: { path: "$genres" } },
					{ $group: {
							_id: '$genres',
							items: {
								$push: '$$ROOT',
							},
							count: { $sum: 1 },
							countPageViewed: { $sum: "$countPageViewed" },
						}
					},
					{ $sort: { countPageViewed: -1, count: -1 } },
					{ $project: {
						_id: false,
						count: true,
						countPageViewed: true,
						name: "$_id.name",
						url: { $concat: [ `/${categoryAliasInUrl}/`, "$_id.alias" ] },
						items: "$items",
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
						name: "Новинки",
						items: "$new"
					}
				],
				genres: "$genres"
			} },
		]);

		collections = [
			...result[0]['collections'],
			...result[0]['genres']
		]
	
		const collectionsFiltered = collections
									.map(collection => ({
										...collection,
										items: collection.items.slice(0, 24)
									}));

		return res.status(200).json(collectionsFiltered);

		Category.aggregate([
			{ $match: {
				aliasInUrl: categoryAliasInUrl
			} },
			{ $project: {
				_id: false,
				name: true, 
				alias: true,
				genres: {
					name: true,
					alias: true
				},
				aliasInUrl: true
			} }
		], (err, category) => {
			if(err) return resError({ res, msg: err });

			const { name, alias, genres, aliasInUrl } = category[0];

			const facet = genres.reduce((obj, genre) => {
				obj[genre.alias] = movieOperations({
					addToMatch: {
						categoryAlias: alias,
						genresAliases: genre.alias
					},
					addToProject: {
						poster: { src: true }
					},
					limit: 24
				});

				return obj;
			}, {})

			const collections = genres.map(genre => (
				{
					name: genre.name,
					items: `$${genre.alias}`,
					url: `/${aliasInUrl}/${genre.alias}`
				}
			))

			Movie.aggregate([
				{ $facet: facet },
				{ $project: {
					collections: collections
				} },
			], (err, result) => {
				if(err) return resError({ res, msg: err });

				result = {
					name,
					...result[0]
				}
	
				return res.status(200).json(result);
	
			});

		});

	} catch(err) {
		return resError({ res, msg: err });
	}
});

router.get('/genre', async (req, res) => {
	const { alias, categoryAlias } = req.query;
	const skip = +(req.query.skip ?? 0);
	const limit = +(req.query.limit > 0 && req.query.limit <= 100 ? req.query.limit : 100);

	if(!alias) return resError({ res,  msg: 'Ожидается alias жанра' });
	if(!categoryAlias) return resError({ res,  msg: 'Ожидается categoryAlias' });

	try {
		const result = await Movie.aggregate([
			{ "$facet": {
				// Название жанра
				"genre": [
					{ $lookup: {
						from: "categories",
						pipeline: [
							{ $match: { 
								alias: categoryAlias,
							} },
							{ $project: {
								_id: false,
								genre: {
									$filter: {
										input: "$genres",
										as: "genre",
										cond: { $eq: ["$$genre.alias", alias] }
									}
								}
							} },
							{ $unwind: { path: "$genre" } },
						],
						as: "category"
					} },
					{ $unwind: { path: "$category" } },
					{ $project: {
						_id: false,
						genreInfo: "$category.genre"
					} },
					{ $limit: 1 }
				],
				// Всего записей
				"totalSize": [
					{ $match: { 
						categoryAlias: categoryAlias,
						genresAliases: alias,
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
						addToMatch: {
							categoryAlias: categoryAlias,
							genresAliases: alias
						},
						addToProject: {
							poster: { src: true }
						},
						limit: limit
					}),
					{ $sort : { _id : -1 } },
					{ $skip: skip },
					{ $limit: limit }
				]
			} },
			{ $limit: 1 },
			{ $unwind: { path: "$genre", preserveNullAndEmptyArrays: true } },
			{ $unwind: { path: "$totalSize", preserveNullAndEmptyArrays: true } },
			{ $project: {
				genre: "$genre.genreInfo",
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