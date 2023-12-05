const user = require('../models/user')

const resetOldSessions = async () => {
	try {
		const users = await user.find({
			sessions: { $elemMatch: { lastVisitAt: { $lte: new Date() - 1000 * 60 * 60 * 24 * 90 } } },
		})
		for (const usr of users) {
			usr.sessions = usr.sessions.filter(
				(session) =>
					session.lastVisitAt >=
					new Date() - 1000 * 60 * 60 * 24 * Number(process.env.SESSUIONS_DAYS)
			)
			await usr.save()
		}
	} catch (error) {
		console.log(error)
	}
}

module.exports = resetOldSessions
