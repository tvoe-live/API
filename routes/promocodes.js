const express = require('express')
const router = express.Router()

const User = require('../models/user')
const Tariff = require('../models/tariff')
const Promocode = require('../models/promocode')
const PaymentLog = require('../models/paymentLog')
const PromocodesLog = require('../models/promocodeLog')

const verify = require('../middlewares/verify')

const resError = require('../helpers/resError')
const resSuccess = require('../helpers/resSuccess')
const getTrimDate = require('../helpers/getTrimDate')
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
			(promocode.finishAt && promocode.finishAt < new Date()) ||
			(promocode.currentAmountActivation &&
				promocode.currentAmountActivation >= promocode.maxAmountActivation)
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
			return resError({ res, msg: 'Данный промокод уже применен' })
		}

		// Создание лога об активации промокода
		await PromocodesLog.create({ promocodeId: promocode._id, userId: req.user._id })

		promocode.currentAmountActivation += 1
		promocode.save()

		if (promocode.discountFormat === 'free-month') {
			const tariff = await Tariff.findOne({ name: '1 месяц' })
			const user = await User.findOne({ _id: req.user._id })

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

			const today = new Date()
			const year = today.getFullYear()
			const month = today.getMonth()
			const day = today.getDate()
			const monthForward = new Date(year, month + 1, day)

			return resSuccess({
				res,
				alert: true,
				msg: 'Промокод успешно активирован',
				startAt: getTrimDate(today),
				finishAt: getTrimDate(monthForward),
				discountFormat: 'free-month',
			})
		}

		return resSuccess({
			res,
			alert: true,
			msg: 'Промокод успешно активирован',
			startAt: getTrimDate(promocode.startAt),
			finishAt: getTrimDate(promocode.finishAt),
			tariffName: promocode.tariffName,
			discountFormat: promocode.discountFormat,
			sizeDiscount: promocode.sizeDiscount,
		})
	} catch (err) {
		return resError({ res, msg: err })
	}
})

/*
 *  Отменить действие промокода
 */
router.patch('/cancel', verify.token, async (req, res) => {
	const { promocodeId } = req.body

	try {
		const promocodeLog = await PromocodesLog.findOne({
			promocodeId: promocodeId,
			userId: req.user._id,
		})

		if (!promocodeLog) {
			return resError({
				res,
				msg: 'Невозможно отменить действие промокода, так как данный промокод не был активирован',
			})
		}

		if (promocodeLog.isCancelled) {
			return resError({ res, msg: 'Промокод уже был отменен ранее' })
		}

		promocodeLog.isCancelled = true
		promocodeLog.save()

		return resSuccess({
			res,
			alert: true,
			msg: 'Действие промокода отменено',
		})
	} catch (err) {
		return resError({ res, msg: err })
	}
})

module.exports = router
