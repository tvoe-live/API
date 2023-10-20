const express = require('express')
const router = express.Router()
const Complaint = require('../models/complaints')
const verify = require('../middlewares/verify')
const resError = require('../helpers/resError')
const resSuccess = require('../helpers/resSuccess')

// Отправка жалобы
router.post('/', verify.token, async (req, res) => {
	let { text, reasons } = req.body
	// userId,
	// 	movieId,
	if (!text && (!reasons || reasons.length)) {
		return resError({
			res,
			alert: true,
			msg: 'Ожидается text и/или reasons',
		})
	}

	try {
		await Complaint.create({
			text,
			reasons,
		})

		return res.status(200).json({
			success: true,
			msg: 'Жалобы отправлены',
			text,
			reasons,
		})
	} catch (err) {
		return resError({ res, msg: err })
	}
})

module.exports = router
