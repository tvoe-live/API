const express = require('express')
const router = express.Router()
const User = require('../models/user')
const Movie = require('../models/movie')
const verify = require('../middlewares/verify')
const resError = require('../helpers/resError')
const mailer = require('../helpers/nodemailer')
require('dotenv').config()

const reasonsDict = {
	BAD_QUALITY_VIDEO: 'Плохое качество видео',
	BAD_SOUND: 'Плохой звук',
	BAD_SUBTITLES: 'Плохо подобраны слова',
	AGE_LIMIT_VIOLATION: 'Нарушение возрастного ограничения',
}

// Отправка жалобы
router.post('/', verify.token, async (req, res) => {
	let { text, reasons, movieId, videoId } = req.body
	const userId = req.user._id

	if (!movieId) {
		return resError({
			res,
			alert: true,
			msg: 'Ожидается movieId',
		})
	}

	const { name, alias } = await Movie.findOne({ _id: movieId }, { name: true, alias: true })
	const { firstname, lastname, authPhone } = await User.findOne(
		{ _id: userId },
		{ firstname: true, lastname: true, authPhone: true }
	)

	if (!name) {
		return resError({
			res,
			alert: true,
			msg: 'Страница не найдена',
		})
	}

	if (!videoId) {
		return resError({
			res,
			alert: true,
			msg: 'Ожидается videoId',
		})
	}

	if (!text && (!reasons || !reasons.length)) {
		return resError({
			res,
			alert: true,
			msg: 'Ожидается text и/или reasons',
		})
	}

	if (text?.length > 500) {
		return resError({
			res,
			alert: true,
			msg: 'Комментарий не должен превышать 500 символов',
		})
	}

	try {
		let textForMail = `Поступила жалоба на фильм '${name}' (videoId ='${videoId}', movieId ='${movieId}') ${process.env.CLIENT_URL}/p/${alias}`

		if (reasons && reasons?.length) {
			const reasonsText = reasons?.map((reason) => `"${reasonsDict[reason]}" `)
			textForMail += `. \n\nПричины жалобы: ${reasonsText}`
		}

		if (text) {
			textForMail += `. \n\nКомментарий: ${text}. \n`
		}

		textForMail += `\nПользователь(id=${userId}):`

		if (firstname) {
			textForMail += ` ${firstname}`
		}

		if (lastname) {
			textForMail += ` ${lastname}`
		}

		if (authPhone) {
			textForMail += `.\nЕго номер телефона ${authPhone}. `
		}

		const message = {
			to: process.env.CONTENT_MAIL,
			subject: 'Жалоба',
			text: textForMail,
		}

		mailer(message)

		return res.status(200).json({
			success: true,
			msg: 'Жалоба отправлена',
		})
	} catch (err) {
		return resError({ res, msg: err })
	}
})

module.exports = router
