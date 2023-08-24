const express = require('express');
const router = express.Router();
const resError = require('../helpers/resError');
const resSuccess = require('../helpers/resSuccess');
const WithdrawalLog = require('../models/withdrawalLog')
const verify = require('../middlewares/verify');

/*
 *  Возврат денежных средств
*/


/*
 * Получение одной записи
 */
router.get('/:_id', verify.token, async (req, res) => {

	const { _id } = req.params;

	if(!_id) {
		return resError({
			res,
			alert: true,
			msg: 'Не получен _id'
		});
	}

	try {
		const withdrawalLog = await WithdrawalLog.findOne({ _id });

		return res.status(200).json( withdrawalLog );
	} catch(err) {
		return resError({ res, msg: err });
	}
});


/*
 * Добавление записи
 */
router.post('/', verify.token, async (req, res) => {

	const {
		status,
		reason
	} = req.body;

	if(!status) {
		return resError({
			res,
			alert: true,
			msg: 'Не получен status'
		});
	}

	if(!reason || !reason.type || !reason.text) {
		return resError({
			res,
			alert: true,
			msg: 'Значение обязательного поля reason не валидно. Параметр reason представляет собой объект с полями type и text'
		});
	}

	try {

		const {_id} = await WithdrawalLog.create({
			userId:req.user._id,
			status,
			reason
		});

		return resSuccess({
			_id,
			res,
			status,
			reason,
			alert: true,
			msg: 'Заявка на вывод средств успешно cоздана'
		})
	} catch (error) {
		return res.json(error);
	}
});

module.exports = router;
