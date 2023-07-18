const express = require('express');
const router = express.Router();
const Movie = require('../models/movie');
const Category = require('../models/category');
const resError = require('../helpers/resError');
const movieOperations = require('../helpers/movieOperations');

/*
 * Подборки и жанры для главной страницы
 */

router.get('/', async (req, res) => {
	const limit = +(req.query.limit >= 6 && req.query.limit <= 18 ? req.query.limit : 18);

	const project = {
		_id: false,
		name: true,
		ageLevel: true,
		shortDesc: true,
		fullDesc: true,
		genresAliases: true,
		poster: true,
		trailer: true,
		logo: true,
		categoryAlias: true,
		willPublishedAt: true
	};

	try {
		const result = await Movie.aggregate([
			{ $facet: {
				
				"willPublishedSoon": [
					{ $match: { 
						willPublishedAt: { $gte: new Date() },
					} },
					{ $project: project },
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
					}
				],
				genres: "$genres",
				willPublishedSoon:'$willPublishedSoon'
			} },
		]);

		collections = [
			...result[0]['collections'],
			...result[0]['genres']
		]
	
		const collectionsFiltered = collections
									.filter(collection => collection.items.length >= 6)
									.map(collection => ({
										...collection,
										items: collection.items.slice(0, limit)
									}));
									
		const willPublishedSoon = result[0]['willPublishedSoon']
		return res.status(200).json({willPublishedSoon, collections:collectionsFiltered});
		
	} catch(err) {
		return resError({ res, msg: err });
	}
});

module.exports = router;