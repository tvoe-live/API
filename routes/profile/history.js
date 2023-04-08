const express = require('express');
const router = express.Router();
const Movie = require('../../models/movie');
const verify = require('../../middlewares/verify');
const resError = require('../../helpers/resError');
const movieOperations = require('../../helpers/movieOperations');

/*
 * Профиль > История просмотров
 */

router.get('/', verify.token, async (req, res) => {

	try {
		const result = await Movie.aggregate([
			{ $lookup: {
				from: "moviepagelogs",
				localField: "_id",
				foreignField: "movieId",
				pipeline: [
					{ $match: { userId: req.user._id } },
					{ $group: { 
						_id: "$movieId", 
						count: { $sum: 1 }, 
						updatedAt: { $push: "$$ROOT.updatedAt" }
					} },
					{ $sort: { updatedAt: -1 } }
				],
				as: "moviepagelogs"
			} },
			{ $unwind: "$moviepagelogs" },
			...movieOperations({
				addToProject: {
					poster: { src: true },
					moviepagelogs: "$moviepagelogs",
					lastLogUpdatedAt: "$moviepagelogs.updatedAt"
				},
				limit: 100
			}),
			{ $sort: { lastLogUpdatedAt: -1 } },
		]);

		return res.status(200).json(result);

	} catch(err) {
		return resError({ res, msg: err });
	}
});

module.exports = router;