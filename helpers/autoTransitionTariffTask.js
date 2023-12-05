const tariff = require('../models/tariff')
const user = require('../models/user')

const autoTransitionTariff = async () => {
	const start = new Date()
	const finish = new Date(start - 3600000)

	try {
		const users = await user.find({
			'subscribe.tariffId': '6569c5e3f74f1d450ec58988',
			'subscribe.finishAt': { $lt: start, $gte: finish },
		})

		const newTariff = await tariff.findById('63dbe11e7f457bc81bc920c9')

		const startAtTariff = new Date()
		const finishAtTariff = new Date(startAtTariff.getTime() + Number(newTariff.duration))

		for (const usr of users) {
			usr.subscribe = {
				startAt: startAtTariff,
				finishAt: finishAtTariff,
				tariffId: newTariff._id,
			}

			await usr.save()
		}
	} catch (error) {
		console.log(error)
	}
}

module.exports = autoTransitionTariff
