const express = require('express')
const router = express.Router()
const Category = require('../../models/category')
const verify = require('../../middlewares/verify')
const user = require('../../models/user')
const movie = require('../../models/movie')
const movieRating = require('../../models/movieRating')
const promocode = require('../../models/promocode')
const tariff = require('../../models/tariff')
const paymentLog = require('../../models/paymentLog')
const moviePageLog = require('../../models/moviePageLog')

/*
 * Админ-панель > Основное
 */

// Кол-во фильмов
// Кол-во сериалов
// Кол-во пользователей
// Кол-во просмотров фильмов / серий
// Кол-во оценок
// Кол-во запросов в поиск

router.get('/stat/auth', async (_, res) => {
	try {
		const users = await user.find(
			{ createdAt: { $gte: new Date(new Date() - 1000 * 60 * 60 * 24 * 7) } },
			{ _id: false, createdAt: true }
		)
		return res.status(200).send(users)
	} catch (error) {
		return res.status(500).send(error)
	}
})

router.get('/stat/views', async (req, res) => {
	try {
		const views = (
			await moviePageLog.find({}, { movieId: true }).populate('movieId', 'series')
		).reduce(
			(acc, item) => {
				if (item.movieId && item.movieId.series.length === 0) {
					acc.films++
				} else if (item.movieId && item.movieId.series.length > 0) {
					acc.serials++
				}

				return acc
			},
			{
				serials: 0,
				films: 0,
			}
		)
		return res.status(200).send(views)
	} catch (error) {
		console.log(error)
		return res.status(500).send(error)
	}
})

router.get('/stat/referral', async (_, res) => {
	try {
		const usersCount = (
			await user.find({ deleted: { $exists: false } }, { referral: true, subscribe: true })
		).reduce(
			(acc, item, _, arr) => {
				acc.users = arr.length
				if (item.referral.userIds) {
					acc.invites += item.referral.userIds.length
				}
				if (item.subscribe) {
					acc.subscribe++
				}

				return acc
			},
			{
				users: 0,
				invites: 0,
				subscribe: 0,
			}
		)

		return res.status(200).send(usersCount)
	} catch (error) {
		console.log(error)
		return res.status(500).send(error)
	}
})

router.get('/stat/film', async (_, res) => {
	try {
		const filmsCountPromise = movie.find({ series: { $size: 0 } }, { _id: true }).count()
		const serialsCountPromise = movie
			.find({ series: { $not: { $size: 0 } } }, { _id: true })
			.count()

		const [filmsCount, serialsCount] = await Promise.all([filmsCountPromise, serialsCountPromise])

		const avgRating =
			(await movieRating.find({ isPublished: true }, { rating: true, _id: false })).reduce(
				(acc, item) => (acc += item.rating),
				0
			) / (await movieRating.find({ isPublished: true }).count())

		return res.status(200).send({ filmsCount, serialsCount, avgRating })
	} catch (error) {
		console.log(error)
		return res.status(500).send(error)
	}
})

router.get('/stat/content', async (_, res) => {
	try {
		const publishedContentPromise = movie.find({ publishedAt: { $exists: true } }).count()
		const notPublishedContentPromise = movie.find({ publishedAt: { $exists: false } }).count()
		const allContentPromise = movie.find().count()

		const [publishedCount, notPublishedCount, allCount] = await Promise.all([
			publishedContentPromise,
			notPublishedContentPromise,
			allContentPromise,
		])

		return res.status(200).send({ publishedCount, notPublishedCount, allCount })
	} catch (error) {
		console.log(error)
		return res.status(500).send(error)
	}
})

router.get('/stat/user', async (_, res) => {
	try {
		const activeUsersCountPromise = user
			.find({ lastVisitAt: { $gte: new Date(new Date() - 1000 * 60 * 60 * 24 * 3) } })
			.count()
		const notActiveUsersCountPromise = user
			.find({ lastVisitAt: { $lt: new Date(new Date() - 1000 * 60 * 60 * 24 * 3) } })
			.count()
		const deletedUsersCountPromise = user.find({ deleted: { $exists: true } }).count()
		const adminsCountPromise = user.find({ role: 'admin' }).count()
		const onlineUsersCountPromise = user
			.find({ lastVisitAt: { $gte: new Date(new Date() - 1000 * 30) } })
			.count()

		const [
			activeUsersCount,
			notActiveUsersCount,
			deletedUsersCount,
			adminsCount,
			onlineUsersCount,
		] = await Promise.all([
			activeUsersCountPromise,
			notActiveUsersCountPromise,
			deletedUsersCountPromise,
			adminsCountPromise,
			onlineUsersCountPromise,
		])

		return res
			.status(200)
			.send({
				activeUsersCount,
				notActiveUsersCount,
				deletedUsersCount,
				adminsCount,
				onlineUsersCount,
			})
	} catch (error) {
		return res.status(500).send(error)
	}
})

router.get('/stat/comments', async (_, res) => {
	try {
		const newCommentCountPromise = movieRating
			.find({ createdAt: { $gte: new Date(new Date() - 1000 * 60 * 60 * 24 * 3) } })
			.count()
		const moderateCommentsCountPromise = movieRating
			.find({ isPublished: false, isDeleted: false })
			.count()
		const deletedCommentsCountPromise = movieRating.find({ isDeleted: true }).count()
		const publishedCommentsCountPromise = movieRating.find({ isPublished: true }).count()

		const [newCommentCount, moderateCommentsCount, deletedCommentsCount, publishedCommentsCount] =
			await Promise.all([
				newCommentCountPromise,
				moderateCommentsCountPromise,
				deletedCommentsCountPromise,
				publishedCommentsCountPromise,
			])

		return res.status(200).send({
			newCommentCount,
			moderateCommentsCount,
			deletedCommentsCount,
			publishedCommentsCount,
		})
	} catch (error) {
		return res.status(500).send(error)
	}
})

router.get('/stat/promocode', async (_, res) => {
	try {
		const activePromocodesCountPromise = promocode.find({ isActive: true }).count()
		const notActivePromocodesCountPromise = promocode.find({ isActive: false }).count()

		const [activePromocodesCount, notActivePromocodesCount] = await Promise.all([
			activePromocodesCountPromise,
			notActivePromocodesCountPromise,
		])

		return res.status(200).send({ activePromocodesCount, notActivePromocodesCount })
	} catch (error) {
		return res.status(500).send(error)
	}
})

router.get('/stat/subscribe', async (_, res) => {
	try {
		const tariffs = await tariff.find({}, { _id: true, name: true }).lean()
		const subsribeCountByTariffsPromise = tariffs.map((t) =>
			paymentLog
				.find(
					{ tariffId: t._id },
					{
						amount: true,
						sum: true,
						type: true,
						_id: false,
						tariffId: true,
						status: true,
						finishAt: true,
					}
				)
				.lean()
		)
		const subsribeCountByTariffs = (await Promise.all(subsribeCountByTariffsPromise)).reduce(
			(acc, item) => acc.concat(item),
			[]
		)

		const paidSubsribes = subsribeCountByTariffs.reduce((acc, item) => {
			if (
				(item.status === 'CONFIRMED' ||
					item.status === 'AUTHORIZED' ||
					item.status === 'success') &&
				(item.type === 'paid' || item.type === 'issued-by-admin' || item.type === 'trial')
			) {
				acc = acc.concat(item)
			}
			return acc
		}, [])

		const activeSubscribe = subsribeCountByTariffs.reduce((acc, item) => {
			if (
				item.finishAt > new Date() &&
				(item.status === 'CONFIRMED' ||
					item.status === 'AUTHORIZED' ||
					item.status === 'success') &&
				(item.type === 'paid' || item.type === 'issued-by-admin' || item.type === 'trial')
			) {
				acc = acc.concat(item)
			}

			return acc
		}, [])

		const refundedSubsribes = subsribeCountByTariffs.reduce((acc, item) => {
			if (item.status === 'REFUNDED') {
				acc = acc.concat(item)
			}
			return acc
		}, [])

		const subsribeStatData = tariffs.reduce((acc, item) => {
			acc[`${item.name}`] = {
				paidSubsribes: paidSubsribes.filter(
					(sub) => sub.tariffId.toString() === item._id.toString()
				).length,
				activeSubscribe: activeSubscribe.filter(
					(sub) => sub.tariffId.toString() === item._id.toString()
				).length,
				refundedSubsribes: refundedSubsribes.filter(
					(sub) => sub.tariffId.toString() === item._id.toString()
				).length,
			}

			return acc
		}, {})

		return res.status(200).send(subsribeStatData)
	} catch (error) {
		console.log(error)
		return res.status(500).send(error)
	}
})

router.get('/stat/tariff', async (_, res) => {
	try {
		const tariffs = await tariff.find({}, { _id: true, name: true }).lean()
		const subsribeCountByTariffsPromise = tariffs.map((t) =>
			paymentLog
				.find(
					{ tariffId: t._id },
					{ amount: true, sum: true, type: true, _id: false, tariffId: true, status: true }
				)
				.lean()
		)
		const subsribeCountByTariffs = (await Promise.all(subsribeCountByTariffsPromise)).reduce(
			(acc, item) => acc.concat(item),
			[]
		)

		const income = subsribeCountByTariffs
			.reduce((acc, item) => {
				if (
					item.amount ||
					(item.sum &&
						(item.status === 'CONFIRMED' ||
							item.status === 'AUTHORIZED' ||
							item.status === 'success'))
				) {
					if (item.amount && !item.sum) {
						acc += item.amount
					} else if (!item.amount && item.sum) {
						acc += item.sum
					} else {
						acc += item.amount
					}
				}
				return acc
			}, 0)
			.toFixed(2)

		const consumption = subsribeCountByTariffs
			.reduce((acc, item) => {
				if (item.amount || (item.sum && item.status === 'REFUNDED')) {
					if (item.amount && !item.sum) {
						acc += item.amount
					} else if (!item.amount && item.sum) {
						acc += item.sum
					} else {
						acc += item.amount
					}
				}
				return acc
			}, 0)
			.toFixed(2)

		const tariffStatData = tariffs.reduce((acc, item) => {
			acc[`${item.name}`] = {
				count: subsribeCountByTariffs.filter(
					(sub) => sub.tariffId.toString() === item._id.toString()
				).length,
				income: Number(
					subsribeCountByTariffs
						.filter((sub) => sub.tariffId.toString() === item._id.toString())
						.reduce((sum, s) => {
							if (
								(s.amount || s.sum) &&
								(s.status === 'CONFIRMED' || s.status === 'AUTHORIZED' || s.status === 'success')
							) {
								if (s.amount && !s.sum) {
									sum += s.amount
								} else if (!s.amount && s.sum) {
									sum += s.sum
								} else {
									sum += s.amount
								}
							}
							return sum
						}, 0)
						.toFixed(2)
				),
			}

			return acc
		}, {})

		return res.status(200).send({
			consumption: Number(consumption),
			income: Number(income),
			tariffStatData,
		})
	} catch (error) {
		return res.status(500).send(error)
	}
})

router.get('/categories', async (req, res) => {
	try {
		const categories = await Category.find(
			{},
			{
				_id: false,
				name: true,
				alias: true,
				aliasInUrl: true,
				genres: {
					name: true,
					alias: true,
				},
			}
		)

		return res.status(200).json(categories)
	} catch (error) {
		return res.json(error)
	}
})

module.exports = router
