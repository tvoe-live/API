const user = require('../models/user')
const { USER_MAX_SESSION_DAYS } = require('../constants')

/**
 * Сron-задача для сброса старых сессий
 */
const resetOldSession = async () => {
	try {
		const users = await user.find({
			sessions: {
				$elemMatch: {
					lastVisitAt: {
						$lte: new Date() - 1000 * 60 * 60 * 24 * +USER_MAX_SESSION_DAYS,
					},
				},
			},
		})
		for (const usr of users) {
			usr.sessions = usr.sessions.filter(
				(session) =>
					session.lastVisitAt >= new Date() - 1000 * 60 * 60 * 24 * +USER_MAX_SESSION_DAYS
			)
			await usr.save()
		}
	} catch (error) {
		console.log(error)
	}
}

module.exports = resetOldSession
