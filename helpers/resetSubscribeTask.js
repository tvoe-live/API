const user = require('../models/user')

/**
 * Cron-задача для сброса старых подписок
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

		for (const user of users) {
			user.subscribe = null
			await user.save()
		}
	} catch (error) {
		console.log(error)
	}
}

module.exports = resetSubscribe
