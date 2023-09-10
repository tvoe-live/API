const express = require('express');
const router = express.Router();
const Movie = require('../models/movie');
const verify = require('../middlewares/verify');
const resError = require('../helpers/resError');
const searchLog = require('../models/searchLog');
const movieOperations = require('../helpers/movieOperations');
const getSearchQuery = require('../middlewares/getSearchQuery');

/*
 * Поиск фильмов, сериалов и всего их персонала сьемочной группы
 */

// Часто ищут
router.get('/oftenSeek', async (req, res) => {
	const skip = +req.query.skip || 0
	const limit = +(req.query.limit > 0 && req.query.limit <= 100 ? req.query.limit : 20);

	const mainAgregation = [
		{
			$group: {
			  _id: "$query",
			  count: { $sum: 1 },
			}
		  },
		  {
			  $match: {
				  count: { $gt: 3 }
			  }
		  },
		  {
			  $sort: {
				  count:-1
			  }
		  },
		  {
			  $limit: 500
		  },
		  {
			$lookup: {
			  from: "movies",
			  let: { searchValue: '$_id' },
			  pipeline: [
				  {
					  $match: {
						  $expr: {
							$and:[
								{ $ne: ["$publishedAt", null] },
								{ $or: [
										{$regexMatch: {
											input: "$name",
											regex:  "$$searchValue",
											options: "i"
										}},
										{$regexMatch: {
											input: "$origName",
											regex:  "$$searchValue",
											options: "i"
										}},
									]
								}
							]
						  }
					  },
					},
				  {
					  $project: {
						  _id:true,
						  categoryAlias: true,
						  series: {
							$cond: {
								if: { $eq: ["$categoryAlias", "serials"] },
								then:  '$series',
								else: "$$REMOVE"
							}
						  },
						  name: true,
						  origName:true,
						  poster:true,
						  dateReleased:true,
						  rating:true,
						  ageLevel:true,
						  shortDesc:true,
						  trailer:true,
						  badge:true,
						  duration: {
							$switch: {
								branches: [
									{ case: { $eq: ["$categoryAlias", "films"] }, then: {
										$sum: {
											$map: {
												"input": "$films",
												"as": "item",
												"in": "$$item.duration"
											}
										},
									   } },
									{ case: { $eq: ["$categoryAlias", "serials"] }, then: {
										$sum: {
											$map: {
												"input": "$series",
												"as": "seasons",
												"in": {
													$sum: {
														$map: {
															"input": "$$seasons",
															"as": "item",
															"in": "$$item.duration"
														}
													}
												}
											}
										},
								   } }
								],
								default: 0
							}
						},
						url: { $concat: [ "/p/", "$alias" ] },
					  }
				  },
			  ],
			  as: "movie"
			}
		  },
		  { $unwind: "$movie" },
		  {
			$group: {
				_id: "$movie._id",
				name: { $first: "$movie.name" },
				origName: { $first: "$movie.origName" },
				poster: { $first: "$movie.poster" },
				generalCount: { $sum: '$count' },
				dateReleased: { $first: '$movie.dateReleased' },
				duration: { $first: '$movie.duration' },
				trailer: { $first: '$movie.trailer' },
				shortDesc: { $first: '$movie.shortDesc' },
				ageLevel: { $first: '$movie.ageLevel' },
				rating: { $first: '$movie.rating' },
				badge: { $first: '$movie.badge' },
				url: { $first: '$movie.url' },
				categoryAlias: { $first: '$movie.categoryAlias' },
				series: { $first: '$movie.series' },
			}
		  },
	]

	try {
		const result = await searchLog.aggregate([
			{ "$facet": {
				// Всего записей
				"totalSize": [
					...mainAgregation,
					{ $group: {
						_id: null,
						count: { $sum: 1 }
					} },
					{ $project: { _id: false } },
					{ $limit: 1 }
				],
				// Список
				"items": [
					...mainAgregation,
					{ $sort: { generalCount:-1 }},
					{$project: {generalCount:false}},
					{ $skip: skip },
					{ $limit: limit },
				]
			} },
			{ $limit: 1 },
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

router.get('/', getSearchQuery, async (req, res) => {
	const skip = +(req.query.skip ?? 0);
	const query = req.searchQuery?.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
	const RegExpQuery = new RegExp(query?.replace(/[eё]/gi, "[её]"), "i");
	const limit = +(req.query.limit > 0 && req.query.limit <= 100 ? req.query.limit : 100);

	const aggregationForTotalSize = {
		$or: [
			{ name: RegExpQuery },
			{ origName: RegExpQuery },
			{ shortDesc: RegExpQuery },
			{ fullDesc: RegExpQuery },
			{ countries: RegExpQuery },
			{ persons: {
				$elemMatch: { name: RegExpQuery }
			} },
		],
		publishedAt: { $ne: null }
	}

	if(!req.searchQuery || !req.searchQuery.length) {
		return resError({
			res,
			alert: true,
			msg: 'Пустая строка поиска'
		});
	}

	if(req.searchQuery.length > 250) {
		return resError({
			res,
			alert: true,
			msg: 'Превышена длина поля поиска'
		});
	}

	try {
		const result = await Movie.aggregate([
			{ "$facet": {
				// Всего записей
				"totalSize": [
					{ $match: aggregationForTotalSize },
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
						addToMatch: aggregationForTotalSize,
						addToProject: {
							poster: { src: true }
						},
						skip,
						limit,
					}),
					{ $sort : { _id : -1 } },
				]
			} },
			{ $limit: 1 },
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

// Добавление записи просмотра страницы в логи
// Из-за обнаружения ботов, логгирование должно быть отдельным запросом
router.post('/addLog', getSearchQuery, async (req, res) => {
	const query = req.searchQuery;

	if(!req.searchQuery || !req.searchQuery.length) {
		return resError({
			res,
			alert: true,
			msg: 'Пустая строка поиска'
		});
	}

	if(req.searchQuery.length > 250) {
		return resError({
			res,
			alert: true,
			msg: 'Превышена длина поля поиска'
		});
	}

	if(req.useragent.isBot) return resError({ res, msg: 'Обнаружен бот' });

	// Получение userId от авторизованных пользователей
	await verify.token(req);
	const user = req.user ? { userId: req.user._id } : {};

	try {
		searchLog.create({
			query,
			device: {
				ip: req.ip,
				os: req.useragent.os,
				isBot: req.useragent.isBot,
				isMobile: req.useragent.isMobile,
				isDesktop: req.useragent.isDesktop,
				browser: req.useragent.browser,
				version: req.useragent.version,
				platform: req.useragent.platform,
			},
			...user
		});

		return res.status(200).json();
	} catch(err) {
		return resError({ res, msg: err });
	}
});

module.exports = router;
