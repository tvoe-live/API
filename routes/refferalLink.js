const { Router } = require('express')
const refferalLinkModel = require('../models/refferalLink')

/**
 * Роут для работы с реф.ссылками
 */
const refferalLinkRouter = Router()

/**
 * Получение реф.ссылки пользователя
 */
refferalLinkRouter.get('/', async (req, res) => {
	try {
		const link = await refferalLinkModel.findOne({ user: req.query.id }, { code: true }).lean()
		return res.status(200).send({ link: `${process.env.API_URL}/link/${link.code}` })
	} catch (error) {
		return res.status(500).send(error)
	}
})

/**
 * Обработка реф.ссылки
 */
refferalLinkRouter.get('/:code', async (req, res) => {
	try {
		const link = await refferalLinkModel.findOne({ code: req.params.code })

		if (!link) {
			return res.status(400).send({ msg: 'Данной ссылки не существует' })
		}

		link.count++
		await link.save()

		return res.redirect(link.url)
	} catch (error) {
		return res.status(500).send(error)
	}
})

module.exports = refferalLinkRouter
