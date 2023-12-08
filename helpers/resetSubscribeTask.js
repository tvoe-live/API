const user = require('../models/user')

/**
 * крон-задача для сброса старых подписок
 */
const resetSubscribe = async () => {
	const start = new Date()
	const finish = new Date(start - 3 * 60 * 1000)

	try {
		const users = await user.find(
			{
				'subscribe.finishAt': { $lt: start, $gte: finish },
			},
			{ subscribe: true }
		)

		for (const usr of users) {
			usr.subscribe = null
			await usr.save()
		}
	} catch (error) {
		console.log(error)
	}
}

module.exports = resetSubscribe
