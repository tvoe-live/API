const { Router } = require('express')
const verify = require('../middlewares/verify')

/**
 * Роут для работы с реф.ссылками
 */
const refferalLinkRouter = Router()

/**
 * Получение реф.ссылки пользователя
 */
refferalLinkRouter.get('/', verify.token, async (req, res) => {
	try {
		const authedUser = !!req.user // Авторизован ли пользователь? true / false
		const link = authedUser ? `${process.env.CLIENT_URL}/?r=${req.user._id}` : null // Реферальная ссылка
		return res.status(200).send({ link })
	} catch (error) {
		return res.status(500).send(error)
	}
})

module.exports = refferalLinkRouter
