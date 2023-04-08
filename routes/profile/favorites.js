const express = require('express');
const router = express.Router();
const Movie = require('../../models/movie');
const verify = require('../../middlewares/verify');
const resError = require('../../helpers/resError');
const movieOperations = require('../../helpers/movieOperations');

/*
 * Профиль > Избранное
 */

router.get('/', verify.token, async (req, res) => {

	try {
		const result = await Movie.aggregate([
			{ $lookup: {
				from: "moviefavorites",
				localField: "_id",
				foreignField: "movieId",
				pipeline: [
					{ $match: { 
						userId: req.user._id,
						isFavorite: true
					} },
					{ $sort: { updatedAt: -1 } }
				],
				as: "favorite"
			} },
			{ $unwind: "$favorite" },
			...movieOperations({
				addToProject: {
					poster: { src: true },
					addedToFavoritesAt: "$favorite.updatedAt"
				},
				limit: 100
			}),
			{ $sort: { addedToFavoritesAt: -1 } },
		]);

		return res.status(200).json(result);

	} catch(err) {
		return resError({ res, msg: err });
	}
});

module.exports = router;