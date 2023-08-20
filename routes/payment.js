const {
	API_URL,
	CLIENT_URL,
	PAYMENT_TERMINAL_KEY,
	REFERRAL_PRECENT_BONUSE,
	PAYMENT_TERMINAL_PASSWORD
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


// Получить токен для проверки подлинности запросов
const getToken = (params) => {
	const concatStr = Object.keys(params) 			// Собрать массив передаваемых данных в виде пар Ключ-Значения
						.sort() 					// Отсортировать массив по алфавиту по ключу
						.map(key => 				// Привести все значения строку и удалить пробелы
							params[key]
								.toString()
								.replace(/\s+/g, '')
						)
						.join('')					// Конкетировать каждое значение

	// Токен SHA-256 из конкетированных данных терминала
	const token = crypto
					.createHash("sha256")
					.update(concatStr)
					.digest("hex")

	return token
}

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
					// Обозначить дату конца активированного тарифа
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
	const { selectedTariffId } = req.body;

	const successURL = new URL(`${CLIENT_URL}/payment/status`);
	const failURL = new URL(`${CLIENT_URL}/payment/status`);

	if(!selectedTariffId) {
		return resError({
			res,
			alert: true,
			msg: 'Требуется выбрать тариф'
		});
	}
	
	const tariffs = await Tariff.find({}, {
		_id: true,
		name: true,
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
		successURL.searchParams.set('id', paymentLog._id);

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

		return res.status(200).json({ urlOfRedirectToPay: successURL });
	}


	// Создание лога о платеже
	const paymentLog = await new PaymentLog({
		type: 'paid',
		userId: req.user._id,
		tariffId: selectedTariff._id
	}).save();

	// В url успешной страницы передать id созданного лога
	successURL.searchParams.set('id', paymentLog._id);
	failURL.searchParams.set('id', paymentLog._id);


	// Параметры терминала
	const terminalParams = {
		TerminalKey: PAYMENT_TERMINAL_KEY, // ID терминала
		SuccessURL: successURL.href, // URL успешной оплаты
		FailURL: failURL.href, // URL неуспешной оплаты
		//SuccessAddCardURL: '', // URL успешной привязки карты
		//FailAddCardURL: '', // URL успешной привязки карты
		NotificationURL: `${API_URL}/payment/notification`, // URL для уведомлений об оплате
		Password: PAYMENT_TERMINAL_PASSWORD, // Пароль терминала

		Amount: selectedTariff.price * 100, // Цена тарифа (в коп)
		OrderId: paymentLog._id, // ID заказа
		Description: `Подписка на ${selectedTariff.name}`, // Описание заказа (для СБП)
		//CustomerKey: 
		//Recurrent:
		PayType: 'O', // Тип проведения платежа ("O" - одностадийная оплата)
		Language: 'ru', // Язык платежной формы
		Receipt: {
			Items: [{
				Name: `Подписка на ${selectedTariff.name}`, // Наименование товара
				Price: selectedTariff.price * 100, // Цена в копейках
				Quantity: 1, // Количество или вес товара
				Amount: selectedTariff.price * 100, // Стоимость товара в копейках. Произведение Quantity и Price
				PaymentMethod: 'lfull_prepayment', // Признак способа расчёта (предоплата 100%)
				PaymentObject: 'commodity', // Признак предмета расчёта (товар)
				Tax: 'vat20', // Ставка НДС (ставка 20%)
				//Ean13: '', // Штрих-код (от Атол)
				//ShopCode: '' // Код магазина
			}],
			FfdVersion: '1.05', // Версия ФФД
			Email: req.user.email || 'support@tvoe.team',
			Phone: req.user.phone || '+74956635979',
			Taxation: "usn_income", // Упрощенная СН (доходы)
		}
	}

	// Получить токен для проверки подлинности запросов
	const token = getToken(terminalParams)

	// Добавить токен в платежный лог
	await PaymentLog.updateOne(
		{ _id: paymentLog._id }, 
		{ $set: { token } }
	);

	// Формирование платежа 
	const { data: initPaymentData } = await axios({
		method: 'POST',
		url: `https://securepay.tinkoff.ru/v2/Init`,
		headers: {
			'Content-Type': 'application/json'
		},
		data: {
			...terminalParams,
			DATA: {
				account: req.user._id,
				DefaultCard: 'none',
				TinkoffPayWeb: 'true',
				YandexPayWeb: 'true',
				Device: req.useragent.isDesktop ? 'Desktop' : 'Mobile',
				DeviceOs: req.useragent.os,
				DeviceWebView: 'true',
				DeviceBrowser: req.useragent.browser,
				NotificationEnableSource: 'TinkoffPay',
				QR: 'true'
			},
			token: token

		}
	})

	return res.status(200).json({ urlOfRedirectToPay: initPaymentData.PaymentURL });
});


/*
 * Обработка уведомления от платежной системы о совершении платежа (Tinkoff)
 */
router.post('/notification', async (req, res) => {
	const body = {
		...req.body,
		Password: PAYMENT_TERMINAL_PASSWORD
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
		TerminalKey: terminalKey
	} = body;

	// Получить токен для проверки подлинности запросов
	const token = getToken(body)
	// Проверка токена
	if(token !== req.body.Token) return resError({ res, msg: 'Неверные данные' });


	amount = amount / 100 // Перевести с копеек в рубли

	const paymentLogId = mongoose.Types.ObjectId(orderId); // ID платежа в эквайринге и в БД
	const paymentLog = await PaymentLog.findOne({ _id: paymentLogId }); // Нахождение платежа в БД по ID

	const user = await User.findOne({ _id: paymentLog.userId }); // Нахождение пользователя платежа
	const tariff = await Tariff.findOne({ _id: paymentLog.tariffId }); // Нахождение оплаченого тарифа
	const tariffDuration = Number(tariff.duration); // Длительность тарифа

	// Дата начала использования тарифа для пользователя
	const startAt = user && user.subscribe ? new Date(user.subscribe.startAt) : new Date();

	// Дата начала использования тарифа после окончания подписки
	const paymentStartAt = user && user.subscribe ? new Date(user.subscribe.finishAt) : new Date();

	// Дата окончания использования тарифа для пользователя
	const finishAt = new Date(paymentStartAt.getTime() + tariffDuration);

	// Обновить платежный лог
	await PaymentLog.updateOne(
		{ _id: paymentLogId }, 
		{ 
			$set: {
				finishAt,
				startAt: paymentStartAt,
				pan,
				amount,
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
				terminalKey
			},
			$unset: { token: null },
			$inc: { '__v': 1 }
		}
	);


	// Начислить рефереру долю с первой подписки пользователя
	const shareWithReferrer = async ({ userId, amount, refererUserId }) => {
		if(!userId || !amount || !refererUserId) return

		const countOfSuccessfulPaid = await PaymentLog.find({
			userId,
			type: 'paid',
			$or: [
				{ status: 'success' },
				{ status: 'CONFIRMED' }
			]
		}).count();

		// Проверить, не было ли ранее успешных оплат у пользователя
		// Либо если amount отрицательный, проверяем на единственную оплату
		const requiredCountOfSuccessfulPaid = Number(amount < 0)

		if(countOfSuccessfulPaid === requiredCountOfSuccessfulPaid) {
			const addToBalance = amount * (REFERRAL_PRECENT_BONUSE / 100)

			await User.updateOne(
				{ _id: refererUserId }, 
				{ $inc: { 
					"referral.balance": addToBalance
				} }
			);
		}
	}

	switch(status) {
		case 'CONFIRMED': // Операция подтверждена
			// Обновить время подписки пользователю
			await User.updateOne(
				{ _id: user._id }, 
				{ $set: {
					subscribe: {
						startAt,
						finishAt,
						tariffId: paymentLog.tariffId
					},
					allowTrialTariff: false
				} }
			)

			await shareWithReferrer({
				amount,
				userId: user._id,
				refererUserId: user.refererUserId
			})

			break;
		case 'REFUNDED': // Произведён возврат
		case 'PARTIAL_REFUNDED': // Произведён частичный возврат
			// Проверить доступен ли еще предыдущий тариф
			const lastActivePayment = await PaymentLog.findOne({
													userId: user._id,
													type: 'paid',
													$or: [
														{ status: 'success' },
														{ status: 'CONFIRMED' }
													],
													finishAt: { $gt: new Date() }
												})
												.sort({ _id: -1 })

			if(!!lastActivePayment) {
				// Обновить время подписки пользователю, если есть предыдущий активный тариф
				await User.updateOne(
					{ _id: user._id }, 
					{ $set: {
						subscribe: {
							startAt: lastActivePayment.startAt,
							finishAt: lastActivePayment.finishAt,
							tariffId: lastActivePayment.tariffId,
						}
					} }
				)
			} else {
				await User.updateOne(
					{ _id: user._id }, 
					{ $unset: { subscribe: null } },
					{ timestamps: false }	
				);
			}


			await shareWithReferrer({
				amount: -amount,
				userId: user._id,
				refererUserId: user.refererUserId
			})

			break;
		case 'AUTHORIZED': // Деньги захолдированы на карте клиента. Ожидается подтверждение операции
		case 'PARTIAL_REVERSED': // Частичная отмена
		case 'REVERSED': // Операция отменена
		case 'REJECTED': // Списание денежных средств закончилась ошибкой
		case '3DS_CHECKING': // Автоматическое закрытие сессии, которая превысила срок пребывания в статусе 3DS_CHECKING (более 36 часов)
		default: break;
	}

	return res.status(200).send('OK');
});


/*
 * Показать пользователю страницу об успешном или неуспешном совершении платежа
 */
router.get('/status', async (req, res) => {
	const { id } = req.query;

	try {
		const paymentLog = await PaymentLog.findOne(
			{ _id: id }, 
			{
				type: true,
				status: true,
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