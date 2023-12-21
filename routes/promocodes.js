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
		const regex = new RegExp(['^', value, '$'].join(''), 'i')
		const promocode = await Promocode.findOne({ value: regex, deleted: { $ne: true } })

		if (!promocode || promocode.deleted || promocode.startAt > new Date() || !promocode.isActive) {
			return resError({ res, msg: 'Данный промокод не существует' })
		}

		if (
			(promocode.finishAt && promocode.finishAt < new Date()) ||
			(promocode.maxAmountActivation &&
				promocode.currentAmountActivation >= promocode.maxAmountActivation)
		) {
			return resError({ res, msg: 'Срок действия указанного промокода истек' })
		}

		if (promocode.isOnlyForNewUsers) {
			const existPaymentLog = await PaymentLog.findOne({ userId: req.user._id, type: 'paid' })
			if (existPaymentLog)
				return resError({ res, msg: 'Промокод доступен только новым пользователям' })
		}

		let promocodeLog = await PromocodesLog.findOne({
			promocodeId: promocode._id,
			userId: req.user._id,
		})

		if (promocodeLog && promocodeLog?.isPurchaseCompleted) {
			return resError({ res, msg: 'Данный промокод уже применен' })
		}

		if (promocode.discountFormat === 'free' && promocode.tariffName == 'univeral') {
			return resError({ res, msg: 'Неверный промокод' })
		}

		if (!promocodeLog) {
			await PromocodesLog.updateMany(
				{
					userId: req.user._id,
					isCancelled: { $ne: true },
					isPurchaseCompleted: { $ne: true },
				},
				{ $set: { isCancelled: true } }
			)

			// Создание лога об активации промокода
			promocodeLog = await PromocodesLog.create({
				promocodeId: promocode._id,
				userId: req.user._id,
			})

			promocode.currentAmountActivation += 1
			promocode.save()
		} else {
			if (promocodeLog.isCancelled) {
				promocodeLog.isCancelled = false
			}
		}

		if (promocode.discountFormat === 'free') {
			promocodeLog.isPurchaseCompleted = true
			promocodeLog.save()

			const tariff = await Tariff.findOne({ name: promocode.tariffName })
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
				user.subscribe = {
					...user.subscribe,
					finishAt: new Date(user.subscribe.finishAt.getTime() + Number(tariff.duration)),
				}
			}
			await user.save()

			const today = new Date()

			return resSuccess({
				res,
				alert: true,
				msg: 'Промокод успешно активирован',
				startAt: getTrimDate(today),
				finishAt: getTrimDate(user.subscribe.finishAt),
				discountFormat: 'free',
			})
		}

		return resSuccess({
			res,
			alert: true,
			msg: 'Промокод успешно активирован',
			startAt: getTrimDate(promocode.startAt),
			finishAt: promocode.finishAt ? getTrimDate(promocode.finishAt) : '∞',
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
