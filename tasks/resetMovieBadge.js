const movie = require('../models/movie')

/**
 * Сron-задача для сброса старых бейджев фильмам/сериалам при заврешении времени
 */
const resetMovieBadge = async () => {
	try {
		const start = new Date()
		const finish = new Date(start - 60 * 1000)

		const movies = await movie.find({
			'badge.finishAt': {
				$lte: finish,
				$exists: true,
			},
		})

		for (const movie of movies) {
			delete movie.badge

			await movie.save()
		}
	} catch (error) {
		console.log(error)
	}
}

module.exports = resetMovieBadge
