const tariff = require('../models/tariff')
const user = require('../models/user')

/**
 * Cron-задача для перехода с тарифа "7 дней за 1 рубль" на тариф "1 месяц"
 */
const autoTransitionTariff = async () => {
	const start = new Date()
	const finish = new Date(start - 3600000)

	try {
		const trialTariff = await tariff.findOne({ price: 1 }).lean()

		const users = await user.find({
			'subscribe.tariffId': trialTariff._id,
			'subscribe.finishAt': { $lt: start, $gte: finish },
		})

		const newTariff = await tariff.findOne({ autoEnableAfterTrialTariff: true }).lean()

		const startAtTariff = new Date()
		const finishAtTariff = new Date(startAtTariff.getTime() + Number(newTariff.duration))

		for (const user of users) {
			user.subscribe = {
				startAt: startAtTariff,
				finishAt: finishAtTariff,
				tariffId: newTariff._id,
			}

			await user.save()
		}
	} catch (error) {
		console.log(error)
	}
}

module.exports = autoTransitionTariff
