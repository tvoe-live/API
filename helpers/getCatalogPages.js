const Movie = require('../models/movie')
const movieOperations = require('../helpers/movieOperations')

/*
 * Список всех страниц фильмов и сериалос с жанрами и годами
 */

const getCatalogPages = async ({ categoryAlias, showGenreName }) => {
	const projectGenreName = showGenreName ? { genreName: true } : {}
	const addToMatch = categoryAlias && categoryAlias !== 'collections' ? { categoryAlias } : {}

	const resultPages = await Movie.aggregate([
		...movieOperations({
			addToMatch,
			addToProject: {
				genres: true,
				dateReleased: true,
				categoryAlias: true,
			},
		}),
		{ $unwind: { path: '$genres' } },
		{
			$group: {
				_id: {
					genreAlias: '$genres.alias',
					categoryAlias: '$categoryAlias',
					dateReleased: { $substr: ['$dateReleased', 0, 4] },
				},
				rating: {
					$addToSet: '$rating',
				},
				genreName: {
					$addToSet: '$genres.name',
				},
			},
		},
		{ $unwind: { path: '$rating', preserveNullAndEmptyArrays: true } },
		{ $unwind: { path: '$genreName' } },
		{
			$project: {
				_id: false,
				...projectGenreName,
				rating: '$rating',
				genreAlias: '$_id.genreAlias',
				dateReleased: '$_id.dateReleased',
				categoryAlias: '$_id.categoryAlias',
			},
		},
		{
			$sort: {
				genreAlias: 1,
				dateReleased: 1,
				categoryAlias: 1,
			},
		},
	])

	// Страницы двух категорий: фильмы и сериалы
	const categoryPages = categoryAlias
		? [{ categoryAlias }]
		: [{ categoryAlias: 'films' }, { categoryAlias: 'serials' }]

	// Страницы с категорией, жанром и годом
	const categoryAndGenresAndDatesAndRating = resultPages.filter(
		(page) =>
			page.rating !== null &&
			page.genreAlias !== '' &&
			page.dateReleased !== '' &&
			page.categoryAlias !== ''
	)

	// Страницы с объединением жанров из фильмов и сериалов
	const collectionAndGenres = resultPages
		.filter((page) => page.genreAlias !== '' && page.categoryAlias !== '')
		.map((page) => ({
			genreName: page.genreName,
			genreAlias: page.genreAlias,
			categoryAlias: 'collections',
		}))
		.filter(
			(
				value,
				index,
				self // Фильтрация на уникальность
			) =>
				index ===
				self.findIndex(
					(t) => t.genreAlias === value.genreAlias && t.categoryAlias === 'collections'
				)
		)

	// Страницы с категорией и жанром
	const categoryAndGenres = resultPages
		.filter((page) => page.genreAlias !== '' && page.categoryAlias !== '')
		.map((page) => ({
			genreName: page.genreName,
			genreAlias: page.genreAlias,
			categoryAlias: page.categoryAlias,
		}))
		.filter(
			(
				value,
				index,
				self // Фильтрация на уникальность
			) =>
				index ===
				self.findIndex(
					(t) => t.genreAlias === value.genreAlias && t.categoryAlias === value.categoryAlias
				)
		)

	// Страницы с категорией и годом
	const categoryAndDates = resultPages
		.filter((page) => page.dateReleased !== '' && page.categoryAlias !== '')
		.map((page) => ({
			dateReleased: page.dateReleased,
			categoryAlias: page.categoryAlias,
		}))
		.filter(
			(
				value,
				index,
				self // Фильтрация на уникальность
			) =>
				index ===
				self.findIndex(
					(t) => t.categoryAlias === value.categoryAlias && t.dateReleased === value.dateReleased
				)
		)

	// Страницы с категорией и рейтингом
	const categoryAndRating = resultPages
		.filter((page) => page.rating !== null && page.categoryAlias !== '')
		.map((page) => ({
			rating: page.rating,
			categoryAlias: page.categoryAlias,
		}))
		.filter(
			(
				value,
				index,
				self // Фильтрация на уникальность
			) =>
				index ===
				self.findIndex(
					(t) =>
						t.categoryAlias === value.categoryAlias &&
						+t.rating === +value.rating &&
						t.rating !== null &&
						t.rating !== ''
				)
		)

	// Страницы с категорией, рейтингом и жанром
	const categoryAndRatingAndGengre = resultPages
		.filter((page) => page.rating !== null && page.categoryAlias !== '' && page.genreAlias !== '')
		.map((page) => ({
			rating: page.rating,
			categoryAlias: page.categoryAlias,
			genreAlias: page.genreAlias,
		}))
		.filter(
			(
				value,
				index,
				self // Фильтрация на уникальность
			) =>
				index ===
				self.findIndex(
					(t) =>
						t.categoryAlias === value.categoryAlias &&
						+t.rating === +value.rating &&
						t.rating !== null &&
						t.rating !== '' &&
						t.genreAlias === value.genreAlias
				)
		)

	// Страницы с категорией, годом релиза и жанром
	const categoryAndDatesAndGengre = resultPages
		.filter(
			(page) => page.dateReleased !== '' && page.categoryAlias !== '' && page.genreAlias !== ''
		)
		.map((page) => ({
			dateReleased: page.dateReleased,
			categoryAlias: page.categoryAlias,
			genreAlias: page.genreAlias,
		}))
		.filter(
			(
				value,
				index,
				self // Фильтрация на уникальность
			) =>
				index ===
				self.findIndex(
					(t) =>
						t.categoryAlias === value.categoryAlias &&
						t.dateReleased === value.dateReleased &&
						t.genreAlias === value.genreAlias
				)
		)

	// Страницы с категорией, годом релиза и рейтингом
	const categoryAndDatesAndRating = resultPages
		.filter((page) => page.dateReleased !== '' && page.categoryAlias !== '' && page.rating !== null)
		.map((page) => ({
			dateReleased: page.dateReleased,
			categoryAlias: page.categoryAlias,
			rating: page.rating,
		}))
		.filter(
			(
				value,
				index,
				self // Фильтрация на уникальность
			) =>
				index ===
				self.findIndex(
					(t) =>
						t.categoryAlias === value.categoryAlias &&
						t.dateReleased === value.dateReleased &&
						t.rating === value.rating
				)
		)

	const result = [
		...categoryPages,
		...categoryAndRating,
		...categoryAndDates,
		...categoryAndGenres,
		...collectionAndGenres,
		...categoryAndGenresAndDatesAndRating,
		...categoryAndRatingAndGengre,
		...categoryAndDatesAndGengre,
		...categoryAndDatesAndRating,
	].flat()

	return result
}

module.exports = getCatalogPages
