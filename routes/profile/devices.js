const express = require('express');
const router = express.Router();
const verify = require('../../middlewares/verify');
const resError = require('../../helpers/resError');

/*
 * Профиль > Мои устройства
 */

router.get('/', verify.token, async (req, res) => {
	const skip = +req.query.skip || 0
	const limit = +(req.query.limit > 0 && req.query.limit <= 100 ? req.query.limit : 100)

	const { sessions } = req.user;

	try {
		const reverseSessions = sessions.reverse();

		return res.status(200).json({
			userToken: req.user.token,
			totalSize: reverseSessions.length,
			sessions: reverseSessions.slice(skip, skip+limit)
		});

	} catch(err) {
		return resError({ res, msg: err });
	}
});

module.exports = router;