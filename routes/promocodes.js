const express = require('express');
const router = express.Router();
const verify = require('../middlewares/verify');
const resError = require('../helpers/resError');
const Promocode = require('../models/promocode')
const PromocodesLog = require('../models/promocodeLog')

const resSuccess = require('../helpers/resSuccess');

/*
 * Промокоды
 */


/*
 *  Активировать промокод
 */
router.patch('/activate', verify.token, async (req, res) => {

	const { value } = req.body

	try {
		const promocode = await Promocode.findOne({value})

		if (!promocode || promocode.startAt > new Date() || promocode.deleted){
			return resError({ res, msg: 'Указанного промокода не существует' });
		}

		if (promocode.finishAt < new Date()){
			return resError({ res, msg: 'Срок действия указанного промокода истек' });
		}

		const promocodeLog = await PromocodesLog.findOne({promocodeId:promocode._id, userId: req.user._id})
		if (promocodeLog){
			return resError({ res, msg: 'Промокод был уже использован ранее!' });
		}

		// здесь должен быть какой то код для получения выгоды от промокода юзеру. Например активирует бесплатную подписку или дает скидку на тариф.

		// Создание лога об активации промокода
		await PromocodesLog.create({promocodeId:promocode._id, userId: req.user._id})

		return resSuccess({
			res,
			alert: true,
			msg: 'Промокод успешно активирован'
		})

	} catch(err) {
		return resError({ res, msg: err });
	}
})

module.exports = router;
