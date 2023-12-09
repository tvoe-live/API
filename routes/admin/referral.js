const express = require('express')
const router = express.Router()
const userSchema = require('../../models/user')
const { default: mongoose } = require('mongoose')
const resError = require('../../helpers/resError')
const verify = require('../../middlewares/verify')
const getSearchQuery = require('../../middlewares/getSearchQuery')
const resSuccess = require('../../helpers/resSuccess')
const checkValidId = require('../../helpers/isValidObjectId')
const { REFERRAL_PERCENT_BONUSE } = require('../../constants')
const ReferralWithdrawalLog = require('../../models/referralWithdrawalLog')

/*
    Роут для поиска пользователей по id email displayName
*/
router.get('/search', async (req, res) => {
	//const skip = +req.query.skip || 0
	const limit = +(req.query.limit > 0 && req.query.limit <= 20 ? req.query.limit : 20)

	// Пооверка параметра на валидность как id
	isValidObjectId = checkValidId(req.query.searchStr)

	try {
		// Если параметром запроса передан валидный id
		if (isValidObjectId) {
			const users = await userSchema.aggregate([
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
													$multiply: ['$amount', +REFERRAL_PERCENT_BONUSE / 100],
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
			//.limit(limit)

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
						name: item.subscribeName?.name,
					},
					connectionCount: item.connectionCount,
					income,
				}
			})

			return res.status(200).send(response)
		}

		const users = await userSchema.aggregate([
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
												$multiply: ['$amount', +REFERRAL_PERCENT_BONUSE / 100],
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
		//.limit(limit)

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
router.get('/', verify.token, verify.isAdmin, getSearchQuery, async (req, res) => {
	const skip = +req.query.skip || 0
	const limit = +(req.query.limit > 0 && req.query.limit <= 20 ? req.query.limit : 20)
	const searchMatch = req.RegExpQuery && {
		$or: [
			...(checkValidId(req.searchQuery) ? [{ _id: mongoose.Types.ObjectId(req.searchQuery) }] : []),
			{ email: req.RegExpQuery },
			{ firstname: req.RegExpQuery },
		],
	}
	const mainAgregation = [
		{
			$match: {
				_id: { $exists: true },
				'referral.userIds': { $exists: true },
				...searchMatch,
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
		{ $match: { rUsers: { $exists: true, $not: { $size: 0 } } } },
	]
	try {
		const result = await userSchema.aggregate([
			{
				$facet: {
					// Всего записей
					totalSize: [
						...mainAgregation,
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
						...mainAgregation,
						{
							//Указываем данные, которые необходимо вернуть
							$project: {
								'rUsers.bonusAmount': true,
								'subscribeName.name': true,
								role: true,
								avatar: true,
								email: true,
								phone: '$authPhone',
								firstname: true,
								refererUserId: true,
								'referral.balance': true,
								displayName: true,
								_id: true,
								'subscribe.startAt': true,
								'subscribe.finishAt': true,
								connectionCount: true,
							},
						},
						{
							$addFields: {
								income: {
									$reduce: {
										input: '$rUsers',
										initialValue: 0,
										in: {
											$add: [
												'$$value',
												{
													$sum: '$$this.bonusAmount.bonuseAmount',
												},
											],
										},
									},
								},
								subscribe: {
									startAt: '$subscribe.startAt',
									finishAt: '$subscribe.finishAt',
									name: '$subscribeName.name',
								},
								balance: '$referral.balance',
							},
						},
						{
							$project: {
								rUsers: false,
								subscribeName: false,
								referral: false,
								displayPhone: false,
							},
						},
						{ $sort: { createdAt: -1 } },
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
		return res.status(200).send(result[0])
	} catch (error) {
		resError(res, error.message)
	}
})

/**
 * Роут для получения запросов на вывод
 */
router.get('/withdrawals', verify.token, verify.isAdmin, async (req, res) => {
	const skip = +req.query.skip || 0
	const limit = +(req.query.limit > 0 && req.query.limit <= 20 ? req.query.limit : 20)

	const mainAgregation = [
		{
			$match: {
				status: 'pending',
			},
		},
		{
			$lookup: {
				from: 'users',
				localField: 'userId',
				foreignField: '_id',
				pipeline: [
					{
						$project: {
							email: true,
							authPhone: true,
							_id: true,
						},
					},
					{
						$addFields: {
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
						},
					},
				],
				as: 'user',
			},
		},
		{
			$unwind: { path: '$user', preserveNullAndEmptyArrays: false },
		},
	]

	try {
		const result = await ReferralWithdrawalLog.aggregate([
			{
				$facet: {
					// Всего записей
					totalSize: [
						...mainAgregation,
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
						...mainAgregation,
						{
							$project: {
								amount: true,
								card: true,
								createdAt: true,
								user: true,
							},
						},
						{ $sort: { createdAt: -1 } },
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
	} catch (e) {
		resError(res, error)
	}
})

/**
 * Роут для изменения статустов запросов на вывод = одобрить или отклонить
 */
router.patch('/withdrawals/:id', verify.token, verify.isAdmin, async (req, res) => {
	const possibleStatuses = ['canceled', 'success', 'pending']

	const id = mongoose.Types.ObjectId(req.params.id)
	const { approverUserId } = req.user._id
	const { status } = req.body

	if (!possibleStatuses.includes(status)) {
		return resError({
			res,
			msg: `Статус ${status} невозможен. Возможные значения: ${possibleStatuses}`,
		})
	}

	if (!id) {
		return resError({ res, msg: 'Не получен id' })
	}

	try {
		const result = await ReferralWithdrawalLog.findOneAndUpdate(
			{
				_id: id,
			},
			{
				$set: {
					status,
					approverUserId,
				},
				$inc: { __v: 1 },
			}
		)

		if (!result) {
			return resError({ res, msg: 'Не найдена запись по указанному id' })
		}

		return resSuccess({
			res,
			alert: true,
			msg: 'Статус обновлен',
		})
	} catch (e) {
		resError(res, error)
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
													$multiply: ['$amount', +REFERRAL_PERCENT_BONUSE / 100],
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
						phone: '$authPhone',
						displayName: true,
						_id: true,
						users: true,
						referral: true,
						subscribe: true,
					},
				},
			])
			.limit(limit)

		user[0].balance = user[0].referral?.balance
		user[0].cardNumber = user[0].referral?.card?.number
		delete user[0].referral

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
