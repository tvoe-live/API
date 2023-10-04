const express = require('express')
const router = express.Router()

const User = require('../models/user')
const Tariff = require('../models/tariff')
const verify = require('../middlewares/verify')
const resError = require('../helpers/resError')
const Promocode = require('../models/promocode')
const PaymentLog = require('../models/paymentLog')
const resSuccess = require('../helpers/resSuccess')
const PromocodesLog = require('../models/promocodeLog')

/*
 * Промокоды
 */

/*
 *  Активировать промокод
 */
router.patch('/activate', verify.token, async (req, res) => {
	const { value } = req.body

	try {
		const promocode = await Promocode.findOne({ value })

		if (!promocode || promocode.deleted || promocode.startAt > new Date() || !promocode.isActive) {
			return resError({ res, msg: 'Данный промокод не существует' })
		}

		if (
			promocode.finishAt < new Date() ||
			promocode.currentAmountActivation >= promocode.maxAmountActivation
		) {
			return resError({ res, msg: 'Срок действия указанного промокода истек' })
		}

		if (promocode.isOnlyForNewUsers) {
			const existPaymentLog = PaymentLog.findOne({ userId: req.user._id, type: 'paid' })
			if (existPaymentLog)
				return resError({ res, msg: 'Промокод доступен только новым пользователям' })
		}

		const promocodeLog = await PromocodesLog.findOne({
			promocodeId: promocode._id,
			userId: req.user._id,
		})

		if (promocodeLog) {
			return resError({ res, msg: 'Даннный промокод уже применен' })
		}

		// Создание лога об активации промокода
		await PromocodesLog.create({ promocodeId: promocode._id, userId: req.user._id })

		promocode.currentAmountActivation += 1
		promocode.save()

		if ((promocode.discountFormat = 'free-month')) {
			const tariff = Tariff.find({ name: '1 месяц' })
			const user = User.find({ _id: req.user._id })

			if (!req.user.subscribe) {
				const startAt = new Date()
				const finishAt = new Date(startAt.getTime() + Number(tariff.duration))

				user.subscribe = {
					startAt,
					finishAt,
					tariffId: tariff._id,
				}
			} else {
				user.subscribe.finishAt = new Date(
					user.subscribe.finishAt.getTime() + Number(tariff.duration)
				)
			}
			user.save()
		}

		return resSuccess({
			res,
			alert: true,
			msg: 'Промокод успешно активирован',
		})
	} catch (err) {
		return resError({ res, msg: err })
	}
})

module.exports = router
