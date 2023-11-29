const express = require('express')
const router = express.Router()
const mongoose = require('mongoose')
const Movie = require('../../models/movie')
const Notification = require('../../models/notification')
const MovieRating = require('../../models/movieRating')
const verify = require('../../middlewares/verify')
const resError = require('../../helpers/resError')
const resSuccess = require('../../helpers/resSuccess')
const getSearchQuery = require('../../middlewares/getSearchQuery')

// Возможные причины для удаления отзыва
const validValues = {
	violationRightsOrContentConfidentialInformation:
		'Отзыв нарушает чьи-то права или содержит конфиденциальную информацию',
	swearingInsultsOrCallsIllegalActions: 'Мат, оскорбления или призыв к противоправным действиям',
	linkOrAdvertising: 'Отзыв со ссылкой или скрытой рекламой',
	missingRelationshipoContent: 'Отзыв не имеет отношения к контенту',
}

/*
 * Админ-панель > Фильмы и сериалы
 */

const moviesFilterOptions = {
	published: {
		$and: [{ publishedAt: { $exists: true } }, { publishedAt: { $not: { $eq: null } } }],
	},
	notpublished: { $or: [{ publishedAt: { $exists: false } }, { publishedAt: null }] },
}

/*
 * Получение списка записей
 */
router.get('/', verify.token, verify.isManager, getSearchQuery, async (req, res) => {
	const skip = +req.query.skip || 0
	const limit = +(req.query.limit > 0 && req.query.limit <= 100 ? req.query.limit : 100)

	const movieFilterParam = req.query.status && moviesFilterOptions[`${req.query.status}`]

	const searchMatch = req.RegExpQuery && {
		name: req.RegExpQuery,
	}

	try {
		const result = await Movie.aggregate([
			{
				$facet: {
					// Всего записей
					totalSize: [
						{
							$match: {
								...searchMatch,
								...movieFilterParam,
							},
						},
						{
							$group: {
								_id: null,
								count: { $sum: 1 },
							},
						},
						{ $project: { _id: false } },
						{ $limit: 1 },
					],
					// Опубликованные
					totalSizePublished: [
						{
							$match: {
								...searchMatch,
								publishedAt: { $ne: null },
							},
						},
						{
							$group: {
								_id: null,
								count: { $sum: 1 },
							},
						},
						{ $project: { _id: false } },
						{ $limit: 1 },
					],
					// Не опубликованные
					totalSizeUnpublished: [
						{
							$match: {
								...searchMatch,
								publishedAt: null,
							},
						},
						{
							$group: {
								_id: null,
								count: { $sum: 1 },
							},
						},
						{ $project: { _id: false } },
						{ $limit: 1 },
					],
					// Список
					items: [
						{
							$match: {
								...searchMatch,
								...movieFilterParam,
							},
						},
						{ $project: { __v: false } },
						{ $sort: { raisedUpAt: -1, _id: -1 } },
						{ $skip: skip },
						{ $limit: limit },
					],
				},
			},
			{ $limit: 1 },
			{ $unwind: { path: '$totalSize', preserveNullAndEmptyArrays: true } },
			{ $unwind: { path: '$totalSizePublished', preserveNullAndEmptyArrays: true } },
			{ $unwind: { path: '$totalSizeUnpublished', preserveNullAndEmptyArrays: true } },
			{
				$project: {
					totalSize: { $cond: ['$totalSize.count', '$totalSize.count', 0] },
					totalSizePublished: {
						$cond: ['$totalSizePublished.count', '$totalSizePublished.count', 0],
					},
					totalSizeUnpublished: {
						$cond: ['$totalSizeUnpublished.count', '$totalSizeUnpublished.count', 0],
					},
					items: '$items',
				},
			},
		])

		return res.status(200).json(result[0])
	} catch (err) {
		return resError({ res, msg: err })
	}
})

/*
 * Получение одной записи
 */
router.get('/movie', verify.token, verify.isManager, async (req, res) => {
	const { _id } = req.query

	try {
		const movie = await Movie.findOne({ _id })

		return res.status(200).json(movie)
	} catch (err) {
		return resError({ res, msg: err })
	}
})

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
	} = req.body

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
		persons,
	}

	if (!Object.keys(req.body).length) return res.json()

	try {
		let movie

		if (_id) {
			// При изменении бейджа поднять медиа страницу во всех списках
			if (badge && badge.finishAt) {
				await Movie.updateOne(
					{ _id },
					{
						$set: {
							raisedUpAt: new Date(),
						},
					}
				)
			}

			if (categoryAlias) {
				movie = await Movie.findOne(
					{ _id },
					{
						films: true,
						series: true,
						categoryAlias: true,
					}
				)

				if (categoryAlias === 'serials' && movie.films && movie.films.length) {
					return resError({
						res,
						alert: true,
						msg: 'Необходимо удалить фильм',
					})
				}

				if (categoryAlias === 'films' && movie.series && movie.series.length) {
					return resError({
						res,
						alert: true,
						msg: 'Необходимо удалить серии',
					})
				}
			}

			if (alias) {
				const existMovie = await Movie.findOne({ _id: { $ne: _id }, alias })
				if (existMovie) {
					return resError({
						res,
						alert: true,
						msg: 'Фильм с таким alias уже существует',
					})
				}
			}

			movie = await Movie.findOneAndUpdate({ _id }, { $set: data }, { new: true })
		} else {
			if (alias) {
				const existMovie = await Movie.findOne({ alias })
				if (existMovie) {
					return resError({
						res,
						alert: true,
						msg: 'Фильм с таким alias уже существует',
					})
				}
			}

			movie = await Movie.create({
				...data,
				raisedUpAt: new Date(),
				creatorUserId: req.user._id,
			})
		}

		return resSuccess({
			res,
			...data,
			alert: true,
			_id: movie._id,
			msg: 'Успешно сохранено',
		})
	} catch (error) {
		return res.json(error)
	}
})

/*
 * Опубликовать / снять с публикации запись
 */
router.put('/publish', verify.token, verify.isManager, async (req, res) => {
	const { _id } = req.body

	if (!_id) {
		return resError({
			res,
			alert: true,
			msg: 'Не получен _id',
		})
	}

	try {
		const movie = await Movie.findOne({ _id })

		if (!movie.publishedAt) {
			// Снять фильм с публикации можно всегда. Опубликовать фильм - только если заполнены обязательные поля

			if (!movie.name) {
				return resError({
					res,
					alert: true,
					msg: 'Необходимо название',
				})
			}

			if (!movie.alias) {
				return resError({
					res,
					alert: true,
					msg: 'Необходим ЧПУ-адрес',
				})
			}

			if (!movie.categoryAlias) {
				return resError({
					res,
					alert: true,
					msg: 'Необходима категория',
				})
			}

			if (!movie.genresAliases || !movie.genresAliases.length) {
				return resError({
					res,
					alert: true,
					msg: 'Необходимы жанры',
				})
			}

			const existMovies = await Movie.find({
				alias: movie.alias,
				publishedAt: { $ne: null },
			})
			if (existMovies.length) {
				return resError({
					res,
					alert: true,
					msg: `Фильм с ЧПУ-адресом ${movie.alias} уже существует`,
				})
			}
		}

		const set = {
			publishedAt: !movie.publishedAt ? new Date() : null,
		}

		await Movie.updateOne({ _id }, { $set: set })

		return resSuccess({
			_id,
			res,
			...set,
			alert: true,
			msg: 'Успешно опубликовано',
		})
	} catch (err) {
		return resError({ res, msg: err })
	}
})

/*
 * Поднять медиа страницу во всех списках
 */
router.put('/raiseUp', verify.token, verify.isManager, async (req, res) => {
	try {
		const { _id } = req.body

		if (!_id) {
			return resError({
				res,
				alert: true,
				msg: 'Не получен _id',
			})
		}

		const set = {
			raisedUpAt: new Date(),
		}

		await Movie.updateOne({ _id }, { $set: set })

		return resSuccess({
			_id,
			res,
			...set,
			alert: true,
			msg: 'Успешное поднятие',
		})
	} catch (err) {
		return resError({ res, msg: err })
	}
})

// Удаление рейтинга и комментария администратором
router.delete('/rating', verify.token, verify.isManager, async (req, res) => {
	let { reviewId, comment, reasons } = req.body

	if (!reviewId) {
		return resError({
			res,
			alert: true,
			msg: 'Ожидается reviewId',
		})
	}

	if (!comment && (!reasons || !Boolean(reasons?.length))) {
		return resError({
			res,
			alert: true,
			msg: 'Ожидается comment и/или reasons',
		})
	}

	reasons?.forEach((reason) => {
		if (!Object.keys(validValues).includes(reason)) {
			return resError({
				res,
				alert: true,
				msg: `Причины ${reason} не существует. Возможные причины - ${Object.keys(validValues)}`,
			})
		}
	})

	reviewId = mongoose.Types.ObjectId(reviewId)

	try {
		const { userId, review } = await MovieRating.findOne({
			_id: reviewId,
		})

		if (!review) {
			return resError({ res, msg: 'Пользователь не оставлял комментарий', alert: true })
		}

		// Обнуление записи из БД
		const { movieId } = await MovieRating.findOneAndUpdate(
			{
				_id: reviewId,
			},
			{
				$set: {
					isDeleted: true,
					deletingInfo: {
						...(!!comment && { comment }),
						...(reasons && reasons.length ? { reasons } : { reasons: [] }),
					},
				},
				$inc: { __v: 1 },
			}
		)

		// Получить все оценки фильма
		const movieRatingLogs = await MovieRating.aggregate([
			{
				$match: {
					movieId,
					isDeleted: { $ne: true },
				},
			},
			{
				$group: {
					_id: null,
					avg: { $avg: '$rating' },
				},
			},
			{
				$project: {
					_id: false,
					avg: true,
				},
			},
		])

		const newMovieRating = movieRatingLogs[0]?.avg || null

		// Обновить среднюю оценку фильма
		await Movie.updateOne({ _id: movieId }, { $set: { rating: newMovieRating } })

		let textForDescr = ''

		if (comment) {
			textForDescr += `Комментарий администратора: ${comment}`
		}

		if (reasons && reasons.length >= 1) {
			reasons.forEach((reason, index) => {
				if (index === 0) {
					textForDescr += ' Нарушенные правила: '
				}
				textForDescr += `- ${validValues[reason]}; `
			})
		}

		// Создание индивидуального уведомления для пользователя
		Notification.create({
			title: `Ваш отзыв "${review}" не был опубликован из-за нарушений правил сервиса:`,
			description: textForDescr,
			type: 'PROFILE',
			receiversIds: [userId],
			willPublishedAt: new Date(),
		})

		return resSuccess({
			res,
			movieId,
			newMovieRating,
			alert: true,
			msg: 'Успешно удалено',
		})
	} catch (err) {
		return resError({ res, msg: err })
	}
})

module.exports = router
