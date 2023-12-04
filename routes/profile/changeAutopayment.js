const { Router } = require('express')
const user = require('../../models/user')
const resSuccess = require('../../helpers/resSuccess')

const subscribeRouter = Router()

subscribeRouter.patch('/change', async (req, res) => {
	try {
		const findedUser = await user.findById(req.query.id)
		findedUser.autoPayment = !findedUser.autoPayment
		await findedUser.save()
		if (findedUser.autoPayment === true) {
			return resSuccess({ res, alert: true, msg: 'Автопродление подписки включено' })
		}
		return resSuccess({ res, alert: true, msg: 'Автопродление подписки отключено' })
	} catch (error) {
		return res.status(500).send(error)
	}
})

module.exports = subscribeRouter
