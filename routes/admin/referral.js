const express = require('express')
const userSchema = require('../../models/user')
const checkValidId = require('../../helpers/isValidObjectId')
const { default: mongoose } = require('mongoose')
const resError = require('../../helpers/resError')
const verify = require('../../middlewares/verify')

const router = express.Router()

/*
    Роут для поиска пользователей по id email displayName
*/
router.get('/search', verify.token, verify.isAdmin, async (req, res) => {
	//const skip = +req.query.skip || 0
	const limit = +(req.query.limit > 0 && req.query.limit <= 20 ? req.query.limit : 20)

	// Пооверка параметра на валидность как id
	isValidObjectId = checkValidId(req.query.searchStr)

	try {
		// Если параметром запроса передан валидный id
		if (isValidObjectId) {
			const users = await userSchema
				.aggregate([
					{
						$match: {
							_id: new mongoose.Types.ObjectId(req.query.searchStr),
							'referral.userIds': { $exists: true },
						},
					},
					{
						// Получение данных о тарифе пользователя
						$lookup: {
							from: 'tariffs',
							localField: 'subscribe.tariffId',
							foreignField: '_id',
							as: 'subscribeName',
						},
					},
					{
						$unwind: { path: '$subscribeName', preserveNullAndEmptyArrays: false },
					},
					{
						// Добавляем поле в котором указываеи кол-во приведенных пользователей
						$addFields: {
							connectionCount: {
								$size: '$referral.userIds',
							},
						},
					},
					{
						// Сбор данныз для подсчета дохода пользователя
						$lookup: {
							from: 'users',
							let: { usersIds: '$referral.userIds' },
							pipeline: [
								{ $match: { $expr: { $in: ['$_id', '$$usersIds'] } } },
								{
									$project: {
										_id: true,

										subscribe: true,
									},
								},
								{
									$lookup: {
										from: 'paymentlogs',
										localField: '_id',
										foreignField: 'userId',
										pipeline: [
											{
												$match: {
													type: 'paid',
												},
											},
											{
												$project: {
													_id: false,
													bonuseAmount: {
														$multiply: ['$amount', +process.env.REFERRAL_PERCENT_BONUSE / 100],
													},
												},
											},
										],
										as: 'bonusAmount',
									},
								},
							],
							as: 'rUsers',
						},
					},
					{
						// Указываем данные, которые необходимо вернуть
						$project: {
							'rUsers.bonusAmount': true,
							'subscribeName.name': true,
							avatar: true,
							email: true,
							phone: true,
							refererUserId: true,
							'referral.balance': true,
							displayName: true,
							_id: true,
							'subscribe.startAt': true,
							'subscribe.finishAt': true,
							connectionCount: true,
						},
					},
				])
				.limit(limit)

			// Убираем пользователей, у которых нет рефералов, но пустой массив есть
			const relevantUsers = users.filter((item) => item.rUsers.length > 0)

			// Считаем доход и преобразуем данные в удобоворимый вариант
			const response = relevantUsers.map((item) => {
				const income = item.rUsers
					.reduce((acc, el) => {
						const sum = el.bonusAmount.reduce((s, item) => (s += item.bonuseAmount), 0)
						acc += sum
						return acc
					}, 0)
					.toFixed(2)

				delete item.rUsers
				return {
					_id: item._id,
					email: item.email,
					avatar: item.avatar,
					balance: item.referral.balance,
					displayName: item.displayName,
					subscribe: {
						startAt: item.subscribe.startAt,
						finishAt: item.subscribe.finishAt,
						name: item.subscribeName.name,
					},
					connectionCount: item.connectionCount,
					income,
				}
			})

			return res.status(200).send(response)
		}

		const users = await userSchema
			.aggregate([
				{
					$match: {
						_id: { $exists: true },
						'referral.userIds': { $exists: true },
						$or: [
							{ displayName: { $regex: req.query.searchStr, $options: 'i' } },
							{ email: { $regex: req.query.searchStr, $options: 'i' } },
						],
					},
				},
				{
					// Получение данных о тарифе пользователя
					$lookup: {
						from: 'tariffs',
						localField: 'subscribe.tariffId',
						foreignField: '_id',
						as: 'subscribeName',
					},
				},
				{
					$unwind: { path: '$subscribeName', preserveNullAndEmptyArrays: false },
				},
				{
					// Добавляем поле в котором указываеи кол-во приведенных пользователей
					$addFields: {
						connectionCount: {
							$size: '$referral.userIds',
						},
					},
				},
				{
					// Сбор данныз для подсчета дохода пользователя
					$lookup: {
						from: 'users',
						let: { usersIds: '$referral.userIds' },
						pipeline: [
							{ $match: { $expr: { $in: ['$_id', '$$usersIds'] } } },
							{
								$project: {
									_id: true,

									subscribe: true,
								},
							},
							{
								$lookup: {
									from: 'paymentlogs',
									localField: '_id',
									foreignField: 'userId',
									pipeline: [
										{
											$match: {
												type: 'paid',
											},
										},
										{
											$project: {
												_id: false,
												bonuseAmount: {
													$multiply: ['$amount', +process.env.REFERRAL_PERCENT_BONUSE / 100],
												},
											},
										},
									],
									as: 'bonusAmount',
								},
							},
						],
						as: 'rUsers',
					},
				},
				{
					// Указываем данные, которые необходимо вернуть
					$project: {
						'rUsers.bonusAmount': true,
						'subscribeName.name': true,
						avatar: true,
						email: true,
						phone: true,
						refererUserId: true,
						'referral.balance': true,
						displayName: true,
						_id: true,
						'subscribe.startAt': true,
						'subscribe.finishAt': true,
						connectionCount: true,
					},
				},
			])
			.limit(limit)

		// Убираем пользователей, у которых нет рефералов, но пустой массив есть
		const relevantUsers = users.filter((item) => item.rUsers.length > 0)

		// Считаем доход и преобразуем данные в удобоворимый вариант
		const response = relevantUsers.map((item) => {
			const income = item.rUsers
				.reduce((acc, el) => {
					const sum = el.bonusAmount.reduce((s, item) => (s += item.bonuseAmount), 0)
					acc += sum
					return acc
				}, 0)
				.toFixed(2)

			delete item.rUsers
			return {
				_id: item._id,
				email: item.email,
				avatar: item.avatar,
				balance: item.referral.balance,
				displayName: item.displayName,
				subscribe: {
					startAt: item.subscribe.startAt,
					finishAt: item.subscribe.finishAt,
					name: item.subscribeName.name,
				},
				connectionCount: item.connectionCount,
				income,
			}
		})

		return res.status(200).send(response)
	} catch (error) {
		resError(res, error)
	}
})

/**
 * Роут для получение пользователей-рефералов
 */
router.get('/', verify.token, verify.isAdmin, async (req, res) => {
	const skip = +req.query.skip || 0
	const limit = +(req.query.limit > 0 && req.query.limit <= 20 ? req.query.limit : 20)

	try {
		const users = await userSchema
			.aggregate([
				{
					$match: {
						_id: { $exists: true },
						'referral.userIds': { $exists: true },
					},
				},
				{
					// Получение данных о тарифе пользователя
					$lookup: {
						from: 'tariffs',
						localField: 'subscribe.tariffId',
						foreignField: '_id',
						as: 'subscribeName',
					},
				},
				{
					$unwind: { path: '$subscribeName', preserveNullAndEmptyArrays: false },
				},
				{
					// Добавляем поле в котором указываеи кол-во приведенных пользователей
					$addFields: {
						connectionCount: {
							$size: '$referral.userIds',
						},
					},
				},
				{
					// Сбор данныз для подсчета дохода пользователя
					$lookup: {
						from: 'users',
						let: { usersIds: '$referral.userIds' },
						pipeline: [
							{ $match: { $expr: { $in: ['$_id', '$$usersIds'] } } },
							{
								$project: {
									_id: true,

									subscribe: true,
								},
							},
							{
								$lookup: {
									from: 'paymentlogs',
									localField: '_id',
									foreignField: 'userId',
									pipeline: [
										{
											$match: {
												type: 'paid',
											},
										},
										{
											$project: {
												_id: false,
												bonuseAmount: {
													$multiply: ['$amount', +process.env.REFERRAL_PERCENT_BONUSE / 100],
												},
											},
										},
									],
									as: 'bonusAmount',
								},
							},
						],
						as: 'rUsers',
					},
				},
				{
					//Указываем данные, которые необходимо вернуть
					$project: {
						'rUsers.bonusAmount': true,
						'subscribeName.name': true,
						avatar: true,
						email: true,
						phone: true,
						refererUserId: true,
						'referral.balance': true,
						displayName: true,
						_id: true,
						'subscribe.startAt': true,
						'subscribe.finishAt': true,
						connectionCount: true,
					},
				},
			])
			.skip(skip)
			.limit(limit)

		// Убираем пользователей, у которых нет рефералов, но пустой массив есть
		const relevantUsers = users.filter((item) => item.rUsers.length > 0)

		// Считаем доход и преобразуем данные в удобоворимый вариант
		const response = relevantUsers.map((item) => {
			const income = item.rUsers
				.reduce((acc, el) => {
					const sum = el.bonusAmount.reduce((s, item) => (s += item.bonuseAmount), 0)
					acc += sum
					return acc
				}, 0)
				.toFixed(2)

			delete item.rUsers
			return {
				_id: item._id,
				email: item.email,
				avatar: item.avatar,
				balance: item.referral.balance,
				displayName: item.displayName,
				subscribe: {
					startAt: item.subscribe.startAt,
					finishAt: item.subscribe.finishAt,
					name: item.subscribeName.name,
				},
				connectionCount: item.connectionCount,
				income,
			}
		})

		return res.status(200).send(response)
	} catch (error) {
		resError(res, error.message)
	}
})

/**
 * Роут для получения детальной информации пользователя-реферала
 */
router.get('/:id', verify.token, verify.isAdmin, async (req, res) => {
	//const skip = +req.query.skip || 0
	const limit = +(req.query.limit > 0 && req.query.limit <= 20 ? req.query.limit : 20)

	try {
		const user = await userSchema
			.aggregate([
				{
					$match: {
						_id: new mongoose.Types.ObjectId(req.params.id),
						'referral.userIds': { $exists: true },
					},
				},
				{
					$lookup: {
						from: 'users',
						let: { usersIds: '$referral.userIds' },
						pipeline: [
							{
								$match: {
									$expr: { $in: ['$_id', '$$usersIds'] },
								},
							},
							{
								$lookup: {
									from: 'paymentlogs',
									localField: '_id',
									foreignField: 'userId',
									pipeline: [
										{
											$match: {
												type: 'paid',
											},
										},
										{
											$project: {
												_id: false,
												bonuseAmount: {
													$multiply: ['$amount', +process.env.REFERRAL_PERCENT_BONUSE / 100],
												},
											},
										},
									],
									as: 'bonusAmount',
								},
							},
							{
								$lookup: {
									from: 'tariffs',
									localField: 'subscribe.tariffId',
									foreignField: '_id',
									as: 'tariff',
								},
							},
							{ $unwind: { path: '$tariff', preserveNullAndEmptyArrays: false } },
							{
								$project: {
									_id: true,
									bonusAmount: true,
									avatar: true,
									email: true,
									phone: true,
									'subscribe.startAt': true,
									'subscribe.finishAt': true,
									displayName: true,
									'tariff.name': true,
								},
							},
						],
						as: 'users',
					},
				},
				{
					$project: {
						'tariff.name': true,
						refererUserId: true,
						avatar: true,
						email: true,
						phone: true,
						'referral.balance': true,
						displayName: true,
						_id: true,
						users: true,
					},
				},
			])
			.limit(limit)

		user[0].balance = user[0].referral.balance
		delete user[0].referral.balance

		const income = user[0].users
			.reduce((acc, el) => {
				const sum = el.bonusAmount.reduce((s, item) => (s += item.bonuseAmount), 0)
				acc += sum
				return acc
			}, 0)
			.toFixed(2)

		const referralUsers = user[0].users.map((usr) => ({
			_id: usr._id,
			email: usr.email,
			avatar: usr.avatar,
			displayName: usr.displayName,
			phone: usr.phone,
			subscribe: {
				startAt: usr.subscribe.startAt,
				finishAt: usr.subscribe.finishAt,
				name: usr.tariff.name,
			},
		}))

		return res.status(200).send({ ...user[0], users: referralUsers, income })
	} catch (error) {
		resError(res, error)
	}
})

module.exports = router
