const { Router } = require('express')
const user = require('../../models/user')

const subscribeRouter = Router()

subscribeRouter.patch('/change', async (req, res) => {
	try {
		const findedUser = await user.findById(req.query.id)
		findedUser.autoPayment = !findedUser.autoPayment
		await findedUser.save()
		return res.status(200).send({ status: 'OK' })
	} catch (error) {
		return res.status(500).send(error)
	}
})

module.exports = subscribeRouter
