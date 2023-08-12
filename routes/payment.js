const { 
	PAYMENT_TERMINAL_KEY,
	REFERRAL_PRECENT_BONUSE
} = process.env;
const express = require('express');
const router = express.Router();
const axios = require('axios');
const crypto = require("crypto");
const mongoose = require('mongoose');
const User = require('../models/user');
const Tariff = require('../models/tariff');
const verify = require('../middlewares/verify');
const resError = require('../helpers/resError');
const PaymentLog = require('../models/paymentLog');

/*
 * Тарифы, создание и обработка платежей
 */

router.get('/tariffs', async (req, res) => {

	try {
		let tariffsResult = await Tariff.aggregate([
			{ $match: {
				hidden: { $ne: true }
			} },
			{ $sort: {
				sort: 1
			} },
			{ $limit: 4 }
		]);

		// Получение данных пользователя, если он авторизован
		await verify.token(req);

		// Добавление информации о запрете использований
		if(req.user) {
			const subscribeTariff = req.user.subscribe ? tariffsResult.find(tariff => tariff._id.toString() === req.user.subscribe.tariffId.toString()) : null;

			tariffsResult = tariffsResult.map(tariff=> {
				let allowSubscribe = true;
				let finishOfSubscriptionIn;

				if(subscribeTariff) {					
					// Запретить докупать текущий или менее по длительности тарифы
					if(+tariff.duration <= +subscribeTariff.duration) allowSubscribe = false;
					// Обозначить дату окончания активированного тарифа
					if(tariff._id === subscribeTariff._id) finishOfSubscriptionIn = req.user.subscribe.finishAt;
				} else {
					// Разрешить пробный бесплатный тариф, если еще не использовались тарифы
					if(tariff.price === 0 && !req.user.allowTrialTariff) allowSubscribe = false;
				}

				return {
					...tariff,
					allowSubscribe,
					finishOfSubscriptionIn
				};
			});
		}

		return res.status(200).json(tariffsResult);

	} catch(err) {
		return resError({ res, msg: err });
	}
});



/*
 * Создание платежа (Tinkoff)
 */
router.post('/createPayment', verify.token, async (req, res) => {
	const { successURL, selectedTariffId } = req.body;
	const successUrlWithPaymentLogId = new URL(successURL);

	if(!selectedTariffId) {
		return resError({
			res,
			alert: true,
			msg: 'Требуется выбрать тариф'
		});
	}
	
	const tariffs = await Tariff.find({}, {
		_id: true,
		price: true,
		duration: true
	});
	const selectedTariff = tariffs.find(tariff => tariff._id.toString() === selectedTariffId);
	const subscribeTariff = req.user.subscribe ? tariffs.find(tariff => tariff._id.toString() === req.user.subscribe.tariffId.toString()) : null;

	if(!selectedTariff) {
		return resError({
			res,
			alert: true,
			msg: 'Тарифа не существует'
		});
	}

	// Если оформлена подписка, можно только увеличить тариф большей длительности
	if(subscribeTariff) {
		if(+selectedTariff.duration <= +subscribeTariff.duration) {
			return resError({
				res,
				alert: true,
				msg: 'Подписку можно только расширить'
			});
		}
	}

	// Бесплатные тарифы выдавать сразу, без платежной системы
	if(selectedTariff.price === 0) {
		if(!req.user.allowTrialTariff) {
			return resError({
				res,
				alert: true,
				msg: 'Тариф уже был использован'
			});
		}

		const tariffDuration = Number(selectedTariff.duration);
		const startAt = new Date();
		const finishAt = new Date(startAt.getTime() + tariffDuration);

		const paymentLog = await new PaymentLog({
			startAt,
			finishAt,
			type: 'trial',
			userId: req.user._id,
			tariffId: selectedTariff._id,
		}).save();

		// В url успешной страницы передать id созданного лога
		successUrlWithPaymentLogId.searchParams.set('id', paymentLog._id);

		// Обновить время подписки пользователю и 
		// запретить использовать беспользовать бесплатный тариф
		await User.updateOne(
			{ _id: req.user._id }, 
			{ $set: {
				subscribe: {
					startAt,
					finishAt,
					tariffId: paymentLog.tariffId
				},
				allowTrialTariff: false
			} }
		);

		return res.status(200).json({ urlOfRedirectToPay: successUrlWithPaymentLogId });
	}

	const paymentLog = await new PaymentLog({
		type: 'paid',
		userId: req.user._id,
		tariffId: selectedTariff._id
	}).save();


	// Получение списока карт клиента
	const { data: cardListData } = await axios({
		method: 'POST',
		url: `https://securepay.tinkoff.ru/v2/GetCardList`,
		body: {
			TerminalKey: PAYMENT_TERMINAL_KEY, // ID терминала
			CustomerKey: 1,
			Token: 2
		}
	})
console.log(cardListData)
return res.status(200)
	// Формирование платежа 
	const { data } = await axios({
		method: 'POST',
		url: `https://securepay.tinkoff.ru/v2/Init`,
		body: {
			TerminalKey: PAYMENT_TERMINAL_KEY, // ID терминала
			Amount: selectedTariff.price, // Цена тарифа
			OrderId: paymentLog._id, // ID заказа
			Description: `Подписка ${selectedTariff.name}`, // Описание заказа (для СБП)
			//CustomerKey: 
			//Recurrent:
		}
	})
console.log(data)
return res.status(200)
	// В url успешной страницы передать id созданного лога
	successUrlWithPaymentLogId.searchParams.set('id', paymentLog._id);

	const urlOfRedirectToPay = new URL('https://yoomoney.ru/quickpay/confirm.xml')
	urlOfRedirectToPay.searchParams.set('receiver', process.env.PAYMENT_RECEIVER);
	urlOfRedirectToPay.searchParams.set('quickpay-form', 'button');
	urlOfRedirectToPay.searchParams.set('paymentType', 'AC');
	urlOfRedirectToPay.searchParams.set('sum', selectedTariff.price);
	urlOfRedirectToPay.searchParams.set('label', paymentLog._id);
	urlOfRedirectToPay.searchParams.set('successURL', successUrlWithPaymentLogId);

	return res.status(200).json({ urlOfRedirectToPay });
});


/*
 * Обработка уведомления от платежной системы о совершении платежа (Tinkoff)
 */
router.post('/notification', async (req, res) => {
	const {
		label,
		sender,
		amount,
		codepro,
		currency,
		datetime,
		sha1_hash: sha1Hash,
		operation_id: operationId,
		withdraw_amount: withdrawAmount,
		notification_type: notificationType
	} = req.body;

	if(!label || !sender || !amount || !codepro || !currency || !datetime || !sha1Hash || !operationId || !withdrawAmount || !notificationType) {
		return resError({ res, msg: 'Недостаточно данных' });
	}

	const paymentLogId = mongoose.Types.ObjectId(label);
	const paymentLog = await PaymentLog.findOne({ _id: paymentLogId });

	const user = await User.findOne({ _id: paymentLog.userId });

	const tariff = await Tariff.findOne({ _id: paymentLog.tariffId });
	const tariffDuration = Number(tariff.duration);
	const startAt = user && user.subscribe ? new Date(user.subscribe.startAt) : new Date();
	const paymentStartAt = user && user.subscribe ? new Date(user.subscribe.finishAt) : new Date();
	const finishAt = new Date(paymentStartAt.getTime() + tariffDuration);

	// Формирование hash из полей запроса для проверки
	const strForHash = `${notificationType}&${operationId}&${amount}&${currency}&${datetime}&${sender}&${codepro}&${process.env.PAYMENT_SERCET}&${label}`;
	const createdHash = crypto.createHash("sha1").update(strForHash).digest("hex");

	// Запретить повторную активацию подписки
	if(paymentLog.status === 'success') return res.status(400).send('Подписка уже оплачена');

	// Запретить тестовые и с ошибочным hash платежи
	if(operationId === 'test-notification' || sha1Hash !== createdHash) return res.status(400).send('Ошбика проверки hash');


	// Начислить рефереру долю с первой подписки пользователя
	if(user.refererUserId) {
		const countOfSuccessfulPaid = await PaymentLog.find({
			type: 'paid',
			status: 'success',
			userId: paymentLog.userId
		}).count();

		// Проверить, не было ли ранее успешных оплат у пользователя
		if(countOfSuccessfulPaid === 0) {
			const addToBalance = amount * (REFERRAL_PRECENT_BONUSE / 100)

			await User.updateOne(
				{ _id: user.refererUserId }, 
				{ $inc: { 
					"referral.balance": addToBalance
				} }
			);
		}
	}

	// Обновить платежный лог
	await PaymentLog.updateOne(
		{ _id: paymentLogId }, 
		{ 
			$set: {
				sender,
				amount,
				finishAt,
				operationId,
				withdrawAmount,
				notificationType,
				status: 'success',
				startAt: paymentStartAt,
			},
			$inc: { '__v': 1 }
		}
	);

	// Обновить время подписки пользователю
	await User.updateOne(
		{ _id: paymentLog.userId }, 
		{ $set: {
			subscribe: {
				startAt,
				finishAt,
				tariffId: paymentLog.tariffId
			},
			allowTrialTariff: false
		} }
	);

	return res.status(200).send('ok');
});

/*
 * Показать пользователю страницу об успешном совершении платежа
 */
router.get('/success', async (req, res) => {
	const { id } = req.query;

	try {
		const paymentLog = await PaymentLog.findOne(
			{ _id: id }, 
			{
				type: true,
				finishAt: true
			}
		);

		return res.status(200).json(paymentLog);
	} catch(err) {
		return resError({ res, msg: err });
	}
});

// /*
//  * Создание платежа (Yoomoney)
//  */
// router.post('/createPayment', verify.token, async (req, res) => {
// 	const { successURL, selectedTariffId } = req.body;
// 	const successUrlWithPaymentLogId = new URL(successURL);

// 	if(!selectedTariffId) {
// 		return resError({
// 			res,
// 			alert: true,
// 			msg: 'Требуется выбрать тариф'
// 		});
// 	}
	
// 	const tariffs = await Tariff.find({}, {
// 		_id: true,
// 		price: true,
// 		duration: true
// 	});
// 	const selectedTariff = tariffs.find(tariff => tariff._id.toString() === selectedTariffId);
// 	const subscribeTariff = req.user.subscribe ? tariffs.find(tariff => tariff._id.toString() === req.user.subscribe.tariffId.toString()) : null;

// 	if(!selectedTariff) {
// 		return resError({
// 			res,
// 			alert: true,
// 			msg: 'Тарифа не существует'
// 		});
// 	}

// 	// Если оформлена подписка, можно только увеличить тариф большей длительности
// 	if(subscribeTariff) {
// 		if(+selectedTariff.duration <= +subscribeTariff.duration) {
// 			return resError({
// 				res,
// 				alert: true,
// 				msg: 'Подписку можно только расширить'
// 			});
// 		}
// 	}

// 	// Бесплатные тарифы выдавать сразу, без платежной системы
// 	if(selectedTariff.price === 0) {
// 		if(!req.user.allowTrialTariff) {
// 			return resError({
// 				res,
// 				alert: true,
// 				msg: 'Тариф уже был использован'
// 			});
// 		}

// 		const tariffDuration = Number(selectedTariff.duration);
// 		const startAt = new Date();
// 		const finishAt = new Date(startAt.getTime() + tariffDuration);

// 		const paymentLog = await new PaymentLog({
// 			startAt,
// 			finishAt,
// 			type: 'trial',
// 			userId: req.user._id,
// 			tariffId: selectedTariff._id,
// 		}).save();

// 		// В url успешной страницы передать id созданного лога
// 		successUrlWithPaymentLogId.searchParams.set('id', paymentLog._id);

// 		// Обновить время подписки пользователю и 
// 		// запретить использовать беспользовать бесплатный тариф
// 		await User.updateOne(
// 			{ _id: req.user._id }, 
// 			{ $set: {
// 				subscribe: {
// 					startAt,
// 					finishAt,
// 					tariffId: paymentLog.tariffId
// 				},
// 				allowTrialTariff: false
// 			} }
// 		);

// 		return res.status(200).json({ urlOfRedirectToPay: successUrlWithPaymentLogId });
// 	}

// 	const paymentLog = await new PaymentLog({
// 		type: 'paid',
// 		userId: req.user._id,
// 		tariffId: selectedTariff._id
// 	}).save();

// 	// В url успешной страницы передать id созданного лога
// 	successUrlWithPaymentLogId.searchParams.set('id', paymentLog._id);

// 	const urlOfRedirectToPay = new URL('https://yoomoney.ru/quickpay/confirm.xml')
// 	urlOfRedirectToPay.searchParams.set('receiver', process.env.PAYMENT_RECEIVER);
// 	urlOfRedirectToPay.searchParams.set('quickpay-form', 'button');
// 	urlOfRedirectToPay.searchParams.set('paymentType', 'AC');
// 	urlOfRedirectToPay.searchParams.set('sum', selectedTariff.price);
// 	urlOfRedirectToPay.searchParams.set('label', paymentLog._id);
// 	urlOfRedirectToPay.searchParams.set('successURL', successUrlWithPaymentLogId);

// 	return res.status(200).json({ urlOfRedirectToPay });
// });


// /*
//  * Обработка уведомления от платежной системы о совершении платежа (Yoomoney)
//  */
// router.post('/notification', async (req, res) => {
// 	const {
// 		label,
// 		sender,
// 		amount,
// 		codepro,
// 		currency,
// 		datetime,
// 		sha1_hash: sha1Hash,
// 		operation_id: operationId,
// 		withdraw_amount: withdrawAmount,
// 		notification_type: notificationType
// 	} = req.body;

// 	if(!label || !sender || !amount || !codepro || !currency || !datetime || !sha1Hash || !operationId || !withdrawAmount || !notificationType) {
// 		return resError({ res, msg: 'Недостаточно данных' });
// 	}

// 	const paymentLogId = mongoose.Types.ObjectId(label);
// 	const paymentLog = await PaymentLog.findOne({ _id: paymentLogId });

// 	const user = await User.findOne({ _id: paymentLog.userId });

// 	const tariff = await Tariff.findOne({ _id: paymentLog.tariffId });
// 	const tariffDuration = Number(tariff.duration);
// 	const startAt = user && user.subscribe ? new Date(user.subscribe.startAt) : new Date();
// 	const paymentStartAt = user && user.subscribe ? new Date(user.subscribe.finishAt) : new Date();
// 	const finishAt = new Date(paymentStartAt.getTime() + tariffDuration);

// 	// Формирование hash из полей запроса для проверки
// 	const strForHash = `${notificationType}&${operationId}&${amount}&${currency}&${datetime}&${sender}&${codepro}&${process.env.PAYMENT_SERCET}&${label}`;
// 	const createdHash = crypto.createHash("sha1").update(strForHash).digest("hex");

// 	// Запретить повторную активацию подписки
// 	if(paymentLog.status === 'success') return res.status(400).send('Подписка уже оплачена');

// 	// Запретить тестовые и с ошибочным hash платежи
// 	if(operationId === 'test-notification' || sha1Hash !== createdHash) return res.status(400).send('Ошбика проверки hash');


// 	// Начислить рефереру долю с первой подписки пользователя
// 	if(user.refererUserId) {
// 		const countOfSuccessfulPaid = await PaymentLog.find({
// 			type: 'paid',
// 			status: 'success',
// 			userId: paymentLog.userId
// 		}).count();

// 		// Проверить, не было ли ранее успешных оплат у пользователя
// 		if(countOfSuccessfulPaid === 0) {
// 			const addToBalance = amount * (REFERRAL_PRECENT_BONUSE / 100)

// 			await User.updateOne(
// 				{ _id: user.refererUserId }, 
// 				{ $inc: { 
// 					"referral.balance": addToBalance
// 				} }
// 			);
// 		}
// 	}

// 	// Обновить платежный лог
// 	await PaymentLog.updateOne(
// 		{ _id: paymentLogId }, 
// 		{ 
// 			$set: {
// 				sender,
// 				amount,
// 				finishAt,
// 				operationId,
// 				withdrawAmount,
// 				notificationType,
// 				status: 'success',
// 				startAt: paymentStartAt,
// 			},
// 			$inc: { '__v': 1 }
// 		}
// 	);

// 	// Обновить время подписки пользователю
// 	await User.updateOne(
// 		{ _id: paymentLog.userId }, 
// 		{ $set: {
// 			subscribe: {
// 				startAt,
// 				finishAt,
// 				tariffId: paymentLog.tariffId
// 			},
// 			allowTrialTariff: false
// 		} }
// 	);

// 	return res.status(200).send('ok');
// });

module.exports = router;