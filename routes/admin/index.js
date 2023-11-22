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

/**
 * Получение данных о динамике роста кол-ва пользователей
 */
router.get('/stat/auth', async (_, res) => {
	try {
		// Получение данных о пользователях за неделю
		const users = await user.find(
			{ createdAt: { $gte: new Date(new Date() - 1000 * 60 * 60 * 24 * 7) } },
			{ _id: false, createdAt: true }
		)
		return res.status(200).send(users)
	} catch (error) {
		return res.status(500).send(error)
	}
})

/**
 * Получение данных о просмотрах
 */
router.get('/stat/views', async (_, res) => {
	try {
		// Выполнение запроса к БД о получении и агригирование данных для ответа
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

/**
 * Получения данных по реф.программе
 */
router.get('/stat/referral', async (_, res) => {
	try {
		// Выполнение запроса к БД о получении и агригирование данных для ответа
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

/**
 * Получение данных о фильмах/сериалах
 */
router.get('/stat/film', async (_, res) => {
	try {
		// Формирование запроса к БД о получении фильмов
		const filmsCountPromise = movie.find({ series: { $size: 0 } }, { _id: true }).count()

		// Формирование запроса к БД о получении сериалов
		const serialsCountPromise = movie
			.find({ series: { $not: { $size: 0 } } }, { _id: true })
			.count()

		// Параллельное выполнение запросов
		const [filmsCount, serialsCount] = await Promise.all([filmsCountPromise, serialsCountPromise])

		// Расчет среднего рейтинга
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

/**
 * Получение данных о контенте на сервисе
 */
router.get('/stat/content', async (_, res) => {
	try {
		// Формирование запроса к БД о получении опубликованного контента
		const publishedContentPromise = movie.find({ publishedAt: { $exists: true } }).count()

		// Формирование запроса к БД о получении не опубликованного контента
		const notPublishedContentPromise = movie.find({ publishedAt: { $exists: false } }).count()

		// Формирование запроса к БД о получении всего контента
		const allContentPromise = movie.find().count()

		// Параллельное выполнение запросов
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

/**
 * Получение данных о пользователях
 */
router.get('/stat/user', async (_, res) => {
	try {
		// Формирование запроса к БД о получении активных пользователей
		const activeUsersCountPromise = user
			.find({ lastVisitAt: { $gte: new Date(new Date() - 1000 * 60 * 60 * 24 * 3) } })
			.count()

		// Формирование запроса к БД о получении не активных пользователей
		const notActiveUsersCountPromise = user
			.find({ lastVisitAt: { $lt: new Date(new Date() - 1000 * 60 * 60 * 24 * 3) } })
			.count()

		// Формирование запроса к БД о получении удаленных пользователей
		const deletedUsersCountPromise = user.find({ deleted: { $exists: true } }).count()

		// Формирование запроса к БД о получении пользователей с провами администратора
		const adminsCountPromise = user.find({ role: 'admin' }).count()

		// Формирование запроса к БД о получении пользователей онлайн
		const onlineUsersCountPromise = user
			.find({ lastVisitAt: { $gte: new Date(new Date() - 1000 * 30) } })
			.count()

		// Параллельное выполнение запросов
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

		return res.status(200).send({
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

/**
 * Получение данных об отзывах
 */
router.get('/stat/comments', async (_, res) => {
	try {
		//Формирование запроса к БД о получении новых отзывов
		const newCommentCountPromise = movieRating
			.find({ createdAt: { $gte: new Date(new Date() - 1000 * 60 * 60 * 24 * 3) } })
			.count()

		//Формирование запроса к БД о получении отзывов на модерации
		const moderateCommentsCountPromise = movieRating
			.find({ isPublished: false, isDeleted: false })
			.count()

		// Формирование запроса к БД о получении удаленных отзывах
		const deletedCommentsCountPromise = movieRating.find({ isDeleted: true }).count()

		//Формирование запроса к БД о получении опубликованных отзывах
		const publishedCommentsCountPromise = movieRating.find({ isPublished: true }).count()

		//Параллельное выполнение запросов
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

/**
 * Получение данных о промокодах
 */
router.get('/stat/promocode', async (_, res) => {
	try {
		// Формирование запроса о получении активных промокодов
		const activePromocodesCountPromise = promocode.find({ isActive: true }).count()

		//Формирование запроса о получении неактивных промокодов
		const notActivePromocodesCountPromise = promocode.find({ isActive: false }).count()

		// Параллельное выполнение запросов
		const [activePromocodesCount, notActivePromocodesCount] = await Promise.all([
			activePromocodesCountPromise,
			notActivePromocodesCountPromise,
		])

		return res.status(200).send({ activePromocodesCount, notActivePromocodesCount })
	} catch (error) {
		return res.status(500).send(error)
	}
})

/**
 * Получение данных о подписках
 */
router.get('/stat/subscribe', async (_, res) => {
	try {
		//Получение данных по тарифам
		const tariffs = await tariff.find({}, { _id: true, name: true }).lean()

		//Формирование запросов к БД
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
		// Параллельное выпполнение запросов и преобразование к итоговому результату
		const subsribeCountByTariffs = (await Promise.all(subsribeCountByTariffsPromise)).reduce(
			(acc, item) => acc.concat(item),
			[]
		)

		// Выборка оплаченных тарифов
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

		// Выборка активных тарифов
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

		//Выборка тарифов по которым был совершен возврат
		const refundedSubsribes = subsribeCountByTariffs.reduce((acc, item) => {
			if (item.status === 'REFUNDED') {
				acc = acc.concat(item)
			}
			return acc
		}, [])

		//Агригация и преобразование данных для ответа
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

/**
 * Получение данных о тарифах
 */
router.get('/stat/tariff', async (_, res) => {
	try {
		//Получаем данные по тарифам
		const tariffs = await tariff.find({}, { _id: true, name: true }).lean()

		//Формирование запросов к БД
		const subsribeCountByTariffsPromise = tariffs.map((t) =>
			paymentLog
				.find(
					{ tariffId: t._id },
					{ amount: true, sum: true, type: true, _id: false, tariffId: true, status: true }
				)
				.lean()
		)
		// Параллельное выполнение запросов к бд и преобразование к итоговому результату
		const subsribeCountByTariffs = (await Promise.all(subsribeCountByTariffsPromise)).reduce(
			(acc, item) => acc.concat(item),
			[]
		)

		//Расчет дахода
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

		//Расчет возвратов
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

		//Агригация и преобразование данных для ответа
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

/**
 * Роут для категорий в админке
 */
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
