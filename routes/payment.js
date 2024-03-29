const { PAYMENT_TERMINAL_PASSWORD } = process.env
const express = require('express')
const router = express.Router()
const axios = require('axios')
const mongoose = require('mongoose')
const User = require('../models/user')
const sleep = require('../helpers/sleep')
const Tariff = require('../models/tariff')
const verify = require('../middlewares/verify')
const resError = require('../helpers/resError')
const PaymentLog = require('../models/paymentLog')
const PromocodeLog = require('../models/promocodeLog')
const isValidObjectId = require('../helpers/isValidObjectId')
const {
	getToken,
	getTerminalParams,
	shareWithReferrer,
	paymentCancelTrialTariff,
} = require('../helpers/payment')

/*
 * Тарифы, создание и обработка платежей
 */

router.get('/tariffs', async (req, res) => {
	try {
		let tariffsResult = await Tariff.aggregate([
			{
				$match: {
					hidden: { $ne: true },
				},
			},
			{
				$sort: {
					sort: 1,
				},
			},
			{ $limit: 5 },
		])

		// Получение данных пользователя, если он авторизован
		await verify.token(req)

		// Добавление информации о запрете использований
		if (req.user) {
			const subscribeTariff = req.user.subscribe
				? tariffsResult.find(
						(tariff) => tariff._id.toString() === req.user.subscribe.tariffId.toString()
				  )
				: null

			const benefitsFromPromocodes = await PromocodeLog.aggregate([
				{
					$match: {
						userId: req.user._id,
						isCancelled: { $ne: true },
						isPurchaseCompleted: { $ne: true },
					},
				},
				{
					$lookup: {
						from: 'promocodes',
						localField: 'promocodeId',
						foreignField: '_id',
						pipeline: [
							{
								$match: {
									startAt: {
										$lte: new Date(),
									},
									$or: [
										{ finishAt: { $gte: new Date() } },
										{ finishAt: { $exists: false } },
										{ finishAt: null },
									],
									discountFormat: { $ne: 'free' },
								},
							},
							{
								$project: {
									_id: true,
									tariffName: true,
									discountFormat: true,
									sizeDiscount: true,
								},
							},
						],
						as: 'promocode',
					},
				},
				{ $unwind: { path: '$promocode' } },
				{
					$project: {
						tariffName: '$promocode.tariffName',
						discountFormat: '$promocode.discountFormat',
						sizeDiscount: '$promocode.sizeDiscount',
						promocodeId: '$promocode._id',
					},
				},
				{
					$group: {
						_id: { tariffName: '$tariffName', discountFormat: '$discountFormat' }, // группируем по уникальным значениям полей tariffName и discountFormat
						maxDiscount: { $max: '$sizeDiscount' }, // находим максимальное значение поля sizeDiscount
						documents: { $push: '$$ROOT' },
					},
				},
				{
					$addFields: {
						promocodeId: {
							$let: {
								vars: {
									documentWithMaxDiscount: {
										$first: {
											$filter: {
												input: '$documents',
												as: 'document',
												cond: { $eq: ['$$document.sizeDiscount', '$maxDiscount'] },
											},
										},
									},
								},
								in: '$$documentWithMaxDiscount.promocodeId',
							},
						},
					},
				},
				{
					$group: {
						_id: '$_id.tariffName',
						benefits: {
							$push: {
								discountFormat: '$_id.discountFormat',
								sizeDiscount: '$maxDiscount',
								promocodeId: '$promocodeId',
							},
						},
					},
				},
			])

			tariffsResult = tariffsResult.map((tariff) => {
				let allowSubscribe = true
				let finishOfSubscriptionIn
				let bonucesPromocodes

				const existBenefitsFromPromocodes = benefitsFromPromocodes.find(
					(benefit) => benefit._id === tariff.name || benefit._id === 'universal'
				)

				if (existBenefitsFromPromocodes) {
					const benefitsWithBestPrice = existBenefitsFromPromocodes?.benefits.reduce(
						(acc, item) => {
							switch (item.discountFormat) {
								case 'percentages':
									const currentPricePercentagesCount =
										(tariff.price * (100 - item.sizeDiscount)) / 100
									if (currentPricePercentagesCount < acc.bestPrice) {
										acc.bestPrice = currentPricePercentagesCount
										acc.info = {
											sizeDiscount: item.sizeDiscount,
											discountFormat: item.discountFormat,
											promocodeId: item.promocodeId,
										}
									}
									return acc

								case 'rubles':
									let currentPriceRublesDiscount = tariff.price - item.sizeDiscount
									if (currentPriceRublesDiscount < 1) currentPriceRublesDiscount = 1
									if (currentPriceRublesDiscount < acc.bestPrice) {
										acc.bestPrice = currentPriceRublesDiscount
										acc.info = {
											sizeDiscount:
												item.sizeDiscount > tariff.price ? tariff.price - 1 : item.sizeDiscount,
											discountFormat: item.discountFormat,
											promocodeId: item.promocodeId,
										}
									}
									return acc

								default:
									return acc
							}
						},
						{ bestPrice: Number(tariff.price) }
					)
					if (benefitsWithBestPrice.bestPrice < tariff.price)
						bonucesPromocodes = benefitsWithBestPrice
				}

				if (subscribeTariff) {
					// Запретить докупать текущий или менее по длительности тарифы
					if (+tariff.duration <= +subscribeTariff.duration) allowSubscribe = false
					// Обозначить дату конца активированного тарифа
					if (tariff._id === subscribeTariff._id)
						finishOfSubscriptionIn = req.user.subscribe.finishAt
				} else {
					// Разрешить пробный бесплатный тариф, если еще не использовались тарифы
					if ((tariff.price === 0 || tariff.price === 1) && !req.user.allowTrialTariff)
						allowSubscribe = false
				}

				return {
					...tariff,
					allowSubscribe,
					finishOfSubscriptionIn,
					bonucesPromocodes,
				}
			})
		}

		return res.status(200).json(tariffsResult)
	} catch (err) {
		return resError({ res, msg: err })
	}
})

/*
 * Создание платежа (Tinkoff)
 */

router.post('/createPayment', verify.token, async (req, res) => {
	const { selectedTariffId } = req.body

	if (!selectedTariffId) {
		return resError({
			res,
			alert: true,
			msg: 'Требуется выбрать тариф',
		})
	}

	if (!isValidObjectId(selectedTariffId)) {
		return resError({
			res,
			alert: true,
			msg: 'Не валидное значение selectedTariffId',
		})
	}

	const { price: selectedTarifPrice } = await Tariff.findOne({ _id: selectedTariffId })

	const benefitsFromPromocodes = await PromocodeLog.aggregate([
		{
			$match: {
				userId: req.user._id,
				isCancelled: { $ne: true },
				isPurchaseCompleted: { $ne: true },
			},
		},
		{
			$lookup: {
				from: 'promocodes',
				localField: 'promocodeId',
				foreignField: '_id',
				pipeline: [
					{
						$match: {
							startAt: {
								$lte: new Date(),
							},
							$or: [
								{ finishAt: { $gte: new Date() } },
								{ finishAt: { $exists: false } },
								{ finishAt: null },
							],
							discountFormat: { $ne: 'free' },
						},
					},
					{
						$lookup: {
							from: 'tariffs',
							localField: 'tariffName',
							foreignField: 'name',
							pipeline: [
								{
									$match: {
										_id: mongoose.Types.ObjectId(selectedTariffId),
									},
								},
								{
									$project: {
										price: true,
									},
								},
							],
							as: 'tariff',
						},
					},
					{
						$addFields: {
							tariff: {
								$cond: [
									{ $eq: ['$tariffName', 'universal'] },
									{
										_id: selectedTariffId,
										price: selectedTarifPrice,
									},
									{
										$arrayElemAt: ['$tariff', 0],
									},
								],
							},
						},
					},
					{
						$project: {
							tariffName: true,
							discountFormat: true,
							sizeDiscount: true,
							tariff: true,
						},
					},
				],
				as: 'promocode',
			},
		},
		{ $unwind: { path: '$promocode', preserveNullAndEmptyArrays: true } },
		{
			$project: {
				promocodeId: '$promocodeId',
				tariffName: '$promocode.tariffName',
				discountFormat: '$promocode.discountFormat',
				sizeDiscount: '$promocode.sizeDiscount',
				price: '$promocode.tariff.price',
				tariffId: '$promocode.tariff._id',
			},
		},
		{ $unwind: { path: '$price', preserveNullAndEmptyArrays: true } },
		{
			$group: {
				_id: { tariffName: '$tariffName', discountFormat: '$discountFormat' }, // группируем по уникальным значениям полей _id и discountFormat
				maxDiscount: { $max: '$sizeDiscount' }, // находим максимальное значение поля sizeDiscount
				price: { $first: '$price' },
				documents: { $push: '$$ROOT' },
			},
		},
		{
			$addFields: {
				promocodeId: {
					$let: {
						vars: {
							documentWithMaxDiscount: {
								$first: {
									$filter: {
										input: '$documents',
										as: 'document',
										cond: { $eq: ['$$document.sizeDiscount', '$maxDiscount'] },
									},
								},
							},
						},
						in: '$$documentWithMaxDiscount.promocodeId',
					},
				},
			},
		},
		{
			$group: {
				_id: '$_id.tariffName',
				initialPrice: { $first: '$price' },
				benefits: {
					$push: {
						discountFormat: '$_id.discountFormat',
						sizeDiscount: '$maxDiscount',
						promocodeId: '$promocodeId',
					},
				},
			},
		},
		{
			$addFields: {
				bestPrice: {
					$let: {
						vars: {
							bestDiscount: {
								$reduce: {
									input: '$benefits',
									initialValue: {
										price: '$initialPrice',
										promocodeId: null,
									},
									in: {
										$let: {
											vars: {
												currentPrice: {
													$cond: [
														{ $eq: ['$$this.discountFormat', 'rubles'] },
														{
															$cond: {
																if: {
																	$lt: [{ $subtract: ['$initialPrice', '$$this.sizeDiscount'] }, 1],
																},
																then: 1,
																else: { $subtract: ['$initialPrice', '$$this.sizeDiscount'] },
															},
														},
														{
															$multiply: [
																'$initialPrice',
																{ $divide: [{ $subtract: [100, '$$this.sizeDiscount'] }, 100] },
															],
														},
													],
												},
											},
											in: {
												$cond: [
													{ $lt: ['$$currentPrice', '$$value.price'] },
													{
														price: '$$currentPrice',
														promocodeId: '$$this.promocodeId',
													},
													'$$value',
												],
											},
										},
									},
								},
							},
						},
						in: {
							value: '$$bestDiscount.price',
							promocodeId: '$$bestDiscount.promocodeId',
						},
					},
				},
			},
		},
	])

	const priceAfterDiscount = benefitsFromPromocodes[0]?.bestPrice?.value
	const promocodeId = benefitsFromPromocodes[0]?.bestPrice?.promocodeId

	const successURL = new URL(`${process.env.CLIENT_URL}/payment/status`)
	const failURL = new URL(`${process.env.CLIENT_URL}/payment/status`)

	const tariffs = await Tariff.find(
		{},
		{
			_id: true,
			name: true,
			price: true,
			duration: true,
		}
	)
	const selectedTariff = tariffs.find((tariff) => tariff._id.toString() === selectedTariffId)
	const subscribeTariff = req.user.subscribe
		? tariffs.find((tariff) => tariff._id.toString() === req.user.subscribe.tariffId.toString())
		: null

	if (!selectedTariff) {
		return resError({
			res,
			alert: true,
			msg: 'Тарифа не существует',
		})
	}

	const price = priceAfterDiscount?.toFixed(2) || selectedTariff.price

	// Если оформлена подписка, можно только увеличить тариф большей длительности
	if (subscribeTariff) {
		if (+selectedTariff.duration <= +subscribeTariff.duration) {
			return resError({
				res,
				alert: true,
				msg: 'Подписку можно только расширить',
			})
		}
	}

	if (!req.user.allowTrialTariff && (selectedTariff.price === 0 || selectedTariff.price === 1)) {
		return resError({
			res,
			alert: true,
			msg: 'Тариф уже был использован',
		})
	}

	// Бесплатные тарифы выдавать сразу, без платежной системы
	if (selectedTariff.price === 0) {
		const tariffDuration = Number(selectedTariff.duration)
		const startAt = new Date()
		const finishAt = new Date(startAt.getTime() + tariffDuration)

		const paymentLog = await new PaymentLog({
			startAt,
			finishAt,
			type: 'trial',
			userId: req.user._id,
			tariffId: selectedTariff._id,
			isChecked: false,
		}).save()

		// В url успешной страницы передать id созданного лога
		successURL.searchParams.set('id', paymentLog._id)

		// Обновить время подписки пользователю и
		// запретить использовать беспользовать бесплатный тариф
		await User.updateOne(
			{ _id: req.user._id },
			{
				$set: {
					subscribe: {
						startAt,
						finishAt,
						tariffId: paymentLog.tariffId,
					},
					allowTrialTariff: false,
				},
			}
		)

		return res.status(200).json({
			paymentId: paymentLog._id,
			urlOfRedirectToPay: successURL,
		})
	}

	// Создание лога о платеже
	const paymentLog = await new PaymentLog({
		type: 'paid',
		userId: req.user._id,
		tariffId: selectedTariff._id,
		isChecked: false,
		...(promocodeId && { promocodeId }), // Если применен промокод, то записать id примененного промокода
		amount: price,
		tariffPrice: selectedTariff.price,
	}).save()

	// В url успешной страницы передать id созданного лога
	successURL.searchParams.set('id', paymentLog._id)
	failURL.searchParams.set('id', paymentLog._id)

	// Получить параметры терминала
	const terminalParams = getTerminalParams({
		orderId: paymentLog._id,
		amount: price,
		tariffName: selectedTariff.name,
		successURL: successURL.href,
		failURL: failURL.href,
		user: {
			_id: req.user._id,
			email: req.user.email,
			phone: req.user.phone,
		},
	})

	// Получить токен для проверки подлинности запросов
	const token = getToken(terminalParams)

	// Добавить токен в платежный лог
	await PaymentLog.updateOne({ _id: paymentLog._id }, { $set: { token } })

	// Формирование платежа
	const { data: initPaymentData } = await axios.post('https://securepay.tinkoff.ru/v2/Init', {
		...terminalParams,
		DATA: {
			account: req.user._id,
			Phone: req.user.authPhone,
			DefaultCard: 'none',
			//TinkoffPayWeb: 'true',
			//YandexPayWeb: 'true',
			Device: req.useragent.isDesktop ? 'Desktop' : 'Mobile',
			DeviceOs: req.useragent.os,
			DeviceWebView: 'true',
			DeviceBrowser: req.useragent.browser,
			//NotificationEnableSource: 'TinkoffPay',
			//QR: 'true',
		},
		token: token,
	})

	return res.status(200).json({
		paymentId: paymentLog._id,
		urlOfRedirectToPay: initPaymentData.PaymentURL,
	})
})

/*
 * Обработка уведомления от платежной системы о совершении платежа (Tinkoff)
 */
router.post('/notification', async (req, res) => {
	const body = {
		...req.body,
		Password: PAYMENT_TERMINAL_PASSWORD,
	}

	delete body.Token

	let {
		Pan: pan,
		Amount: amount,
		CardId: cardId,
		Status: status,
		ExpDate: expDate,
		Message: message,
		Details: details,
		OrderId: orderId,
		Success: success,
		RebillId: rebillId,
		PaymentId: paymentId,
		ErrorCode: errorCode,
		TerminalKey: terminalKey,
	} = body

	// Получить токен для проверки подлинности запросов
	const token = getToken(body)
	// Проверка токена
	if (req.body.Token && token !== req.body.Token) return resError({ res, msg: 'Неверные данные' })

	amount = amount / 100 // Перевести с копеек в рубли

	const paymentLogId = mongoose.Types.ObjectId(orderId) // ID платежа в эквайринге и в БД
	const paymentLog = await PaymentLog.findOne({ _id: paymentLogId }) // Нахождение платежа в БД по ID

	const user = await User.findOne({ _id: paymentLog.userId }) // Нахождение пользователя платежа
	const tariff = await Tariff.findOne({ _id: paymentLog.tariffId }) // Нахождение оплаченого тарифа
	const tariffDuration = Number(tariff.duration) // Длительность тарифа

	// Дата начала использования тарифа для пользователя
	const startAt = user && user.subscribe ? new Date(user.subscribe.startAt) : new Date()

	// Дата начала использования тарифа после окончания подписки
	const paymentStartAt = user && user.subscribe ? new Date(user.subscribe.finishAt) : new Date()

	// Дата окончания использования тарифа для пользователя
	const finishAt = new Date(paymentStartAt.getTime() + +tariffDuration)

	// Обновить статус платежного лога, если деньги захолдированы
	if (paymentLog.status === 'AUTHORIZED' && status === 'CONFIRMED') {
		await PaymentLog.updateOne(
			{ _id: paymentLogId },
			{
				$set: {
					status,
					isChecked: false,
				},
			}
		)

		return res.status(200).send('OK')
	}

	// Обновить платежный лог
	await PaymentLog.updateOne(
		{ _id: paymentLogId },
		{
			$set: {
				pan,
				cardId,
				status,
				expDate,
				message,
				details,
				orderId,
				success,
				rebillId,
				paymentId,
				errorCode,
				terminalKey,
				isChecked: paymentLog.isChecked ? paymentLog.isChecked : false,
				...((status === 'AUTHORIZED' || status === 'CONFIRMED') && {
					finishAt,
					startAt: paymentStartAt,
				}),
				amount: status === 'REFUNDED' || status === 'PARTIAL_REFUNDED' ? paymentLog.amount : amount,
				...((status === 'REFUNDED' ||
					status === 'PARTIAL_REFUNDED' ||
					status === 'REVERSED' ||
					status === 'PARTIAL_REVERSED') && { refundedAmount: amount }),
			},
			$unset: { token: null },
			$inc: { __v: 1 },
		}
	)

	switch (status) {
		case 'AUTHORIZED': // Деньги захолдированы на карте клиента. Ожидается подтверждение операции
		case 'CONFIRMED': // Операция подтверждена
			// Обновить время подписки пользователю
			await User.updateOne(
				{ _id: user._id },
				{
					$set: {
						subscribe: {
							startAt,
							finishAt,
							tariffId: paymentLog.tariffId,
						},
						rebillId: rebillId || null,
						allowTrialTariff: false,
					},
				}
			)

			// Вернуть 1 рубль пользователю за оплату пробного тарифа
			// По рекомендации банка добавлена задержка в 5 секунд
			if (+amount === 1) {
				await sleep(5000)
				await paymentCancelTrialTariff({ paymentId })

				break
			}

			// Поделиться с реферерами долей с дохода от оплаты
			await shareWithReferrer({
				amount,
				userId: user._id,
				refererUserId: user.refererUserId,
			})

			if (paymentLog.promocodeId) {
				await PromocodeLog.findOneAndUpdate(
					{
						promocodeId: paymentLog.promocodeId,
						userId: user._id,
					},
					{
						$set: {
							isPurchaseCompleted: true,
						},
						$inc: { __v: 1 },
					}
				)
			}

			break
		case 'REFUNDED': // Произведён возврат
		case 'PARTIAL_REFUNDED': // Произведён частичный возврат
			// Не изменять пользователя при подписки за 1 ₽
			if (amount === 1) break

			// Проверить доступен ли еще предыдущий тариф
			const lastActivePayment = await PaymentLog.findOne({
				userId: user._id,
				type: 'paid',
				finishAt: { $gte: new Date() },
				status: { $in: ['success', 'CONFIRMED', 'AUTHORIZED'] },
			}).sort({ _id: -1 })

			if (!!lastActivePayment) {
				// Обновить время подписки пользователю, если есть предыдущий активный тариф
				await User.updateOne(
					{ _id: user._id },
					{
						$set: {
							autoPayment: false,
							subscribe: {
								startAt: lastActivePayment.startAt,
								finishAt: lastActivePayment.finishAt,
								tariffId: lastActivePayment.tariffId,
							},
						},
					},
					{
						timestamps: false,
						$unset: {
							rebillId: false,
						},
					}
				)
			} else {
				await User.updateOne(
					{ _id: user._id },
					{
						$unset: {
							rebillId: false,
							subscribe: false,
							autoPayment: false,
						},
					},
					{ timestamps: false }
				)
			}

			await shareWithReferrer({
				amount: -amount,
				userId: user._id,
				refererUserId: user.refererUserId,
			})

			break
		case 'PARTIAL_REVERSED': // Частичная отмена
		case 'REVERSED': // Операция отменена
		case 'REJECTED':
		case '3DS_CHECKING': // Автоматическое закрытие сессии, которая превысила срок пребывания в статусе 3DS_CHECKING (более 36 часов)
		default:
			break
	}

	return res.status(200).send('OK')
})

/*
 * Показать пользователю страницу об успешном или неуспешном совершении платежа
 */
router.get('/status', async (req, res) => {
	const { id } = req.query

	try {
		const paymentLog = await PaymentLog.findOneAndUpdate(
			{ _id: id },
			{ $set: { isChecked: true } },
			{
				tariffId: true,
				isChecked: true,
				type: true,
				status: true,
				finishAt: true,
			}
		)

		const tariff = await Tariff.findOne({ _id: paymentLog.tariffId })

		return res.status(200).json({
			_id: paymentLog._id,
			type: paymentLog.type,
			userId: paymentLog.userId,
			createdAt: paymentLog.createdAt,
			updatedAt: paymentLog.updatedAt,
			isChecked: paymentLog.isChecked ?? true,
			status:
				(paymentLog.status === 'REVERSED' || paymentLog.status === 'REFUNDED') &&
				paymentLog.amount === 1
					? 'CONFIRMED'
					: paymentLog.status,
			tariff,
		})
	} catch (err) {
		return resError({ res, msg: err })
	}
})

module.exports = router
