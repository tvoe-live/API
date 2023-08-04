const express = require('express');
const router = express.Router();
const verify = require('../../middlewares/verify');
const resError = require('../../helpers/resError');

/*
 * Уведомления
 */


/*
 * Список уведомлений для пользователя
 */
router.get('/', verify.token, async (req, res) => {
	const skip = +req.query.skip || 0
	const limit = +(req.query.limit > 0 && req.query.limit <= 100 ? req.query.limit : 100);


	try {
		

		return res.status(200).json(result);

	} catch(err) {
		return resError({ res, msg: err });
	}
})


/*
 * Пометить уведомления прочитанными
 */
router.patch('/markAsRead', verify.token, async (req, res) => {

	try {

	} catch(err) {
		return resError({ res, msg: err });
	}
})


module.exports = router;