const { Router } = require('express')
const ShortUniqueId = require('short-unique-id')
const refferalLinkModel = require('../models/refferalLink')

const refferalLinkRouter = Router()

refferalLinkRouter.post('/create', async (req, res) => {
	try {
		const createdLink = await refferalLinkModel.findOne({ user: req.query.id })

		if (createdLink) {
			return res.status(200).send({ link: `${process.env.API_URL}/${createdLink.code}` })
		}

		const { randomUUID } = new ShortUniqueId({ length: 10 })
		const code = randomUUID()

		const link = await refferalLinkModel.create({
			code,
			user: req.query.id,
		})

		return res.status(201).send({ link: `${process.env.API_URL}/${link.code}` })
	} catch (error) {
		console.log(error)
		return res.status(500).send(error)
	}
})

refferalLinkRouter.get('/', async (req, res) => {
	try {
		const link = await refferalLinkModel.findOne({ user: req.query.id }, { code: true }).lean()
		return res.status(200).send({ link: `${process.env.API_URL}/${link.code}` })
	} catch (error) {
		return res.status(500).send(error)
	}
})

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
