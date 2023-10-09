const express = require('express')
const userSchema = require('../../models/user')
const checkValidId = require('../../helpers/isValidObjectId')
const { default: mongoose } = require('mongoose')
const resError = require('../../helpers/resError')

const router = express.Router()

router.get('/search', async (req, res) => {
	//const skip = +req.query.skip || 0
	const limit = +(req.query.limit > 0 && req.query.limit <= 20 ? req.query.limit : 20)

	//Проверка строкового параметра(id или не id)
	isValidObjectId = checkValidId(req.query.searchStr)

	try {
		//если id ищем по id
		if (isValidObjectId) {
			const user = await userSchema
				.find(
					{
						_id: req.query.searchStr,
						'referral.userIds': { $exists: true },
					},
					['_id', 'displayName', 'email']
				)
				.limit(limit)

			return res.status(200).send(user)
		}

		//в случае если не id ищем по никнейму или почте
		const users = await userSchema
			.find(
				{
					$or: [
						{ displayName: { $regex: req.query.searchStr, $options: 'i' } },
						{ email: { $regex: req.query.searchStr, $options: 'i' } },
					],
					'referral.userIds': { $exists: true },
				},
				['_id', 'displayName', 'email']
			)
			.limit(limit)

		// возвращаем найденных мальчиков
		return res.status(200).send(users)
	} catch (error) {
		resError(res, error)
	}
})

router.get('/', async (req, res) => {
	const skip = +req.query.skip || 0
	const limit = +(req.query.limit > 0 && req.query.limit <= 20 ? req.query.limit : 20)

	try {
		//собираем необходмые данные
		const users = await userSchema
			.aggregate([
				{
					//Отбираем мальчиков с идентификатором и с индитификаторами реферальных пользователей
					$match: {
						_id: { $exists: true },
						'referral.userIds': { $exists: true },
					},
				},
				{
					// узнаем название тарифа которым владеет мальчик
					$lookup: {
						from: 'tariffs',
						localField: 'subscribe.tariffId',
						foreignField: '_id',
						as: 'subscribeName',
					},
				},
				{
					// Распаковочка полученного названия тарифа
					$unwind: { path: '$subscribeName', preserveNullAndEmptyArrays: false },
				},
				{
					// Добавляем поле в котором указываеи кол-во реферальных пупсов
					$addFields: {
						connectionCount: {
							$size: '$referral.userIds',
						},
					},
				},
				{
					// получаем информацию об реферальных пупсов
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
								//Получаем цену тарифа каждого реферального мальчика
								$lookup: {
									from: 'tariffs',
									localField: 'subscribe.tariffId',
									foreignField: '_id',
									as: 'tariffPrice',
								},
							},
						],
						// представляем реферальных мальчиков как rUsers
						as: 'rUsers',
					},
				},
				{
					//Указываем возвразаемые значения
					$project: {
						'subscribeName.name': true,
						'rUsers.tariffPrice.price': true,
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

		//Убираем всех мальчиков у которых нет рефералов, но видимо были
		const relevantUsers = users.filter((item) => item.rUsers.length > 0)

		//считаем их доход
		const response = relevantUsers.map((item) => {
			const income = item.rUsers
				.reduce((acc, el) => (acc += el.tariffPrice[0].price * 0.2), 0)
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

		res.status(200).send(response)
	} catch (error) {
		resError(res, error.message)
	}
})

router.get('/:id', async (req, res) => {
	const skip = +req.query.skip || 0
	const limit = +(req.query.limit > 0 && req.query.limit <= 20 ? req.query.limit : 20)

	try {
		// отбираем пацанов
		const user = await userSchema
			.aggregate([
				{
					// находим пупса, у которого соответствует id
					$match: {
						_id: new mongoose.Types.ObjectId(req.params.id),
						'referral.userIds': { $exists: true },
					},
				},
				{
					// собираем данные пупсов которые от него рефералились
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
								// Забираем тарифы мальчиков
								$lookup: {
									from: 'tariffs',
									localField: 'subscribe.tariffId',
									foreignField: '_id',
									as: 'tariff',
								},
							},
							// Распоковочка тарифа
							{ $unwind: { path: '$tariff', preserveNullAndEmptyArrays: false } },
							{
								$project: {
									_id: true,
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
					// возвращаем данные
					$project: {
						'tariff.name': true,
						refererUserId: true,
						avatar: true,
						email: true,
						phone: true,
						displayName: true,
						_id: true,
						users: true,
					},
				},
			])
			.skip(skip)
			.limit(limit)

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

		return res.status(200).send({ ...user[0], users: referralUsers })
	} catch (error) {
		resError(res, error)
	}
})

module.exports = router
