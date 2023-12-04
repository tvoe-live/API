const movie = require('../models/movie')

const upMovieTask = async () => {
	try {
		const movies = await movie.find({
			'badge.finishAt': {
				$lte: new Date(),
				$gte: new Date(new Date() - 60 * 1000),
			},
		})

		for (const movie of movies) {
			movie.badge = {}
			await movie.save()
		}
	} catch (error) {
		console.log(error)
	}
}

module.exports = upMovieTask
