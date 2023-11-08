const express = require('express')
const router = express.Router()
const mongoose = require('mongoose')
const verify = require('../../middlewares/verify')
const resError = require('../../helpers/resError')
const MovieRating = require('../../models/movieRating')
const Movie = require('../../models/movie')
const getSearchQuery = require('../../middlewares/getSearchQuery')
const getBoolean = require('../../helpers/getBoolean')
const resSuccess = require('../../helpers/resSuccess')

/*
 * Админ-панель > История рейтингов
 */

// Получение списка пользователей
router.get('/', verify.token, verify.isAdmin, getSearchQuery, async (req, res) => {
	const skip = +req.query.skip || 0
	const limit = +(req.query.limit > 0 && req.query.limit <= 100 ? req.query.limit : 100)

	const searchMatch = req.RegExpQuery && {
		$or: [
			...(isValidObjectId(req.searchQuery)
				? [{ _id: mongoose.Types.ObjectId(req.searchQuery) }]
				: []),
			{ email: req.RegExpQuery },
			{ firstname: req.RegExpQuery },
		],
	}

	try {
		const result = await MovieRating.aggregate([
			{
				$facet: {
					// Всего записей
					totalSize: [
						{
							$lookup: {
								from: 'movies',
								localField: 'movieId',
								foreignField: '_id',
								pipeline: [{ $project: { _id: true } }],
								as: 'movie',
							},
						},
						{ $unwind: { path: '$movie' } },
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
							$lookup: {
								from: 'movies',
								localField: 'movieId',
								foreignField: '_id',
								pipeline: [
									{
										$project: {
											_id: false,
											name: true,
											poster: {
												src: true,
											},
										},
									},
								],
								as: 'movie',
							},
						},
						{ $unwind: { path: '$movie' } },
						{
							$lookup: {
								from: 'users',
								localField: 'userId',
								foreignField: '_id',
								pipeline: [
									{
										$match: {
											...searchMatch,
										},
									},
									{
										$project: {
											role: true,
											email: true,
											avatar: true,
											subscribe: true,
											firstname: true,
										},
									},
								],
								as: 'user',
							},
						},
						{
							$unwind: {
								path: '$user',
								preserveNullAndEmptyArrays: !req.searchQuery,
							},
						},
						{
							$project: {
								userId: false,
								movieId: false,
							},
						},
						{ $sort: { _id: -1 } }, // Была сортировка updatedAt
						{ $skip: skip },
						{ $limit: limit },
					],
				},
			},
			{ $limit: 1 },
			{ $unwind: { path: '$totalSize', preserveNullAndEmptyArrays: true } },
			{
				$project: {
					totalSize: { $cond: ['$totalSize.count', '$totalSize.count', 0] },
					items: '$items',
				},
			},
		])

		return res.status(200).json(result[0])
	} catch (err) {
		return resError({ res, msg: err })
	}
})

// Получение списка отзывов
router.get('/reviews', verify.token, verify.isAdmin, async (req, res) => {
	const skip = +req.query.skip || 0
	const limit = +(req.query.limit > 0 && req.query.limit <= 100 ? req.query.limit : 100)

	const isPublished = getBoolean(req.query.is_published)
	const isDeleted = getBoolean(req.query.is_deleted)

	const match = {
		$match: {
			$and: [
				{
					review: { $ne: null },
				},

				...(isPublished ? [{ isPublished: true }] : []),

				...(typeof isPublished !== 'undefined' && !isPublished
					? [{ $or: [{ isPublished: { $eq: false } }, { isPublished: { $exists: false } }] }]
					: []),

				...(isDeleted ? [{ isDeleted: true }] : [{ isDeleted: { $ne: true } }]),
			],
		},
	}

	try {
		const result = await MovieRating.aggregate([
			{
				$facet: {
					// Всего записей
					totalSize: [
						match,
						{
							$lookup: {
								from: 'movies',
								localField: 'movieId',
								foreignField: '_id',
								pipeline: [{ $project: { _id: true } }],
								as: 'movie',
							},
						},
						{ $unwind: { path: '$movie' } },
						{
							$unwind: {
								path: '$user',
								preserveNullAndEmptyArrays: true,
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
						match,
						{
							$lookup: {
								from: 'movies',
								localField: 'movieId',
								foreignField: '_id',
								pipeline: [
									{
										$project: {
											_id: false,
											name: true,
											poster: {
												src: true,
											},
											url: { $concat: ['/p/', '$alias'] },
										},
									},
								],
								as: 'movie',
							},
						},
						{ $unwind: { path: '$movie' } },
						{
							$lookup: {
								from: 'users',
								localField: 'userId',
								foreignField: '_id',
								pipeline: [
									{
										$addFields: {
											phone: {
												$cond: {
													if: { $ifNull: ['$authPhone', true] },
													then: '$initial_phone',
													else: '$authPhone',
												},
											},
											isHaveSubscribe: {
												$cond: {
													if: {
														$and: [
															{ $ne: ['$subscribe', null] },
															{ $gt: ['$subscribe.finishAt', new Date()] },
														],
													},
													then: true,
													else: false,
												},
											},
											isReferral: {
												$cond: {
													if: {
														$and: [
															{ $ne: ['$referral', null] },
															{ $ne: ['$referral.userIds', null] },
															{ $eq: [{ $type: '$referral.userIds' }, 'array'] },
															{ $gt: [{ $size: '$referral.userIds' }, 0] },
														],
													},
													then: true,
													else: false,
												},
											},
										},
									},
									{
										$project: {
											role: true,
											email: true,
											avatar: true,
											subscribe: true,
											firstname: true,
											phone: true,
											isHaveSubscribe: true,
										},
									},
								],
								as: 'user',
							},
						},
						{
							$unwind: {
								path: '$user',
								preserveNullAndEmptyArrays: true,
							},
						},
						{
							$project: {
								userId: false,
								movieId: false,
								__v: false,
							},
						},
						{ $sort: { _id: -1 } }, // Была сортировка updatedAt
						{ $skip: skip },
						{ $limit: limit },
					],
				},
			},
			{ $limit: 1 },
			{ $unwind: { path: '$totalSize', preserveNullAndEmptyArrays: true } },
			{
				$project: {
					totalSize: { $cond: ['$totalSize.count', '$totalSize.count', 0] },
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
 * Опубликовать / снять с публикации отзыв о фильме
 */
router.post('/publish', verify.token, verify.isAdmin, async (req, res) => {
	const { _id } = req.body

	if (!_id) {
		return resError({
			res,
			alert: true,
			msg: 'Не получен _id',
		})
	}

	try {
		const movieRating = await MovieRating.findOne({ _id })
		const set = {
			isPublished: !movieRating.isPublished,
		}

		await MovieRating.updateOne({ _id }, { $set: set })

		return resSuccess({
			res,
			_id,
			alert: true,
			msg: set.isPublished ? 'Успешно опубликовано' : 'Успешно снято с публикации',
		})
	} catch (err) {
		return resError({ res, msg: err })
	}
})

// Удаление рейтинга и комментария
router.delete('/rating', verify.token, async (req, res) => {
	let { reviewId } = req.body

	if (!reviewId) {
		return resError({
			res,
			alert: true,
			msg: 'Ожидается reviewId',
		})
	}

	reviewId = mongoose.Types.ObjectId(reviewId)

	try {
		// Обнуление записи из БД
		const movieRating = await MovieRating.findOneAndUpdate(
			{
				_id: reviewId,
			},
			{
				$set: {
					isDeleted: true,
				},
				$inc: { __v: 1 },
			}
		)

		// Получить все оценки фильма
		const movieRatingLogs = await MovieRating.aggregate([
			{
				$match: {
					movieId: movieRating.movieId,
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
		await Movie.updateOne({ _id: movieRating.movieId }, { $set: { rating: newMovieRating } })

		return resSuccess({
			res,
			alert: true,
			movieId: movieRating.movieId,
			newMovieRating,
			msg: 'Успешно удалено',
		})
	} catch (err) {
		return resError({ res, msg: err })
	}
})

module.exports = router
