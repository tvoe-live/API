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

// Часто ищут (! Сейчас логика из карусели !)
router.get('/oftenSeek', async (req, res) => {
	const skip = +req.query.skip || 0
	const limit = +(req.query.limit > 0 && req.query.limit <= 100 ? req.query.limit : 100);

	const agregationListForTotalSize = [
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
			],
			as: "countPageViewed"
		} },
		...movieOperations({
			addToProject: {
				countPageViewed: { $size: "$countPageViewed" },
				poster: { src: true }
			},
			sort: { countPageViewed: -1, raisedUpAt: -1 },
		}),
	]

	try {
		const result = await Movie.aggregate([
			{
				"$facet": {
					"totalSize":[
						...agregationListForTotalSize,
						{ $group: { 
							_id: null, 
							count: { $sum: 1 }
						} },
						{ $project: { _id: false } },
						{ $limit: 1 }
					],
					"items": [
						...agregationListForTotalSize,
						{ $project: { 
							countPageViewed: false
						} },
						{ $skip: skip },
						{ $limit: limit },
					]
				}
			},
			{ $unwind: { path: "$totalSize", preserveNullAndEmptyArrays: true } },
			{ $project:{
				totalSize: { $cond: [ "$totalSize.count", "$totalSize.count", 0] },
				items: "$items",
			}}
		]);

		return res.status(200).json(result[0]);

	} catch(err) {
		return resError({ res, msg: err });
	}
});

router.get('/', getSearchQuery, async (req, res) => {
	const skip = +(req.query.skip ?? 0);
	const query = req.searchQuery?.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
	const RegExpQuery = new RegExp(query, 'i');
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