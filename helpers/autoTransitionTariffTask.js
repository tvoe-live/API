const tariff = require('../models/tariff')
const user = require('../models/user')

/**
 * Крон-задача для перехода с тарифа 7дней за 1 рубль на 1 месяц
 */
const autoTransitionTariff = async () => {
	const start = new Date()
	const finish = new Date(start - 3600000)

	try {
		const users = await user.find({
			'subscribe.tariffId': process.env.SEVEN_DAYS_BY_ONE_RUB_TARIFF_ID,
			'subscribe.finishAt': { $lt: start, $gte: finish },
		})

		console.log(users)

		const newTariff = await tariff.findOne({ autoSwitchingFromTrialTariff: true }).lean()

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
