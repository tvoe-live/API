const Movie = require('../models/movie');
const movieOperations = require('../helpers/movieOperations');

/*
 * Список всех страниц фильмов и сериалос с жанрами и годами
 */

const getCatalogPages = async ({ categoryAlias, showGenreName }) => {
	const projectGenreName = showGenreName ? { genreName: true } : {};
	const addToMatch = categoryAlias && categoryAlias !== 'collections' ? { categoryAlias } : {};

	const resultPages = await Movie.aggregate([
		...movieOperations({
			addToMatch,
			addToProject: {
				genres: true,
				dateReleased: true,
				categoryAlias: true,
			},
		}),
		{ $unwind: { path: "$genres" } },
		{ $group: {
				_id: {
					rating: "$rating",
					genreAlias: "$genres.alias",
					categoryAlias: "$categoryAlias",
					dateReleased: { $substr: [ "$dateReleased", 0, 4 ] },
				},
				genreName: {
					$addToSet: "$genres.name"
				}
		} },
		{ $unwind: { path: "$genreName" } },
		{ $project: {
			_id: false,
			...projectGenreName,
			rating: "$_id.rating",
			genreAlias: "$_id.genreAlias",
			dateReleased: "$_id.dateReleased",
			categoryAlias: "$_id.categoryAlias",
		} },
		{ $sort: {
			genreAlias: 1,
			dateReleased: 1,
			categoryAlias: 1,
		} },
	]);

	// Страницы двух категорий: фильмы и сериалы
	const categoryPages = categoryAlias ? [
		{ categoryAlias },
	] : [
		{ categoryAlias: 'films' },
		{ categoryAlias: 'serials' }
	];

	// Страницы с категорией, жанром и годом
	const categoryAndGenresAndDates = resultPages
					.filter(page =>
						page.genreAlias !== "" && 
						page.dateReleased !== "" &&
						page.categoryAlias !== "");

	// Страницы с объединением жанров из фильмов и сериалов
	const collectionAndGenres = categoryAndGenresAndDates
								.map(page => ({
									genreName: page.genreName,
									genreAlias: page.genreAlias,
									categoryAlias: 'collections'
								}))
								.filter((value, index, self) => // Фильтрация на уникальность
									index === self.findIndex((t) => (
										t.genreAlias === value.genreAlias && 
										t.categoryAlias === 'collections'
									))
								);
	
	// Страницы с категорией и жанром
	const categoryAndGenres = categoryAndGenresAndDates
								.map(page => ({
									genreName: page.genreName,
									genreAlias: page.genreAlias,
									categoryAlias: page.categoryAlias
								}))
								.filter((value, index, self) => // Фильтрация на уникальность
									index === self.findIndex((t) => (
										t.genreAlias === value.genreAlias && 
										t.categoryAlias === value.categoryAlias
									))
								);

	// Страницы с категорией и годом
	const categoryAndDates = categoryAndGenresAndDates
								.map(page => ({
									dateReleased: page.dateReleased,
									categoryAlias: page.categoryAlias
								}))
								.filter((value, index, self) => // Фильтрация на уникальность
									index === self.findIndex((t) => (
										t.categoryAlias === value.categoryAlias && 
										t.dateReleased === value.dateReleased
									))
								);
	
	const result = [
		...categoryPages,
		...categoryAndDates,
		...categoryAndGenres,
		...collectionAndGenres,
		...categoryAndGenresAndDates
	].flat();

	return result;
};

module.exports = getCatalogPages;
