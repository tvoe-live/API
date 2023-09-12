const express = require("express");
const router = express.Router();
const Movie = require("../../models/movie");
const verify = require("../../middlewares/verify");
const resError = require("../../helpers/resError");
const movieOperations = require("../../helpers/movieOperations");

/*
 * Профиль > Закладки
 */

router.get("/", verify.token, async (req, res) => {
	const skip = +req.query.skip || 0;
	const limit = +(req.query.limit > 0 && req.query.limit <= 100 ? req.query.limit : 100);

	const lookup = [
		{
			$lookup: {
				from: "moviebookmarks",
				localField: "_id",
				foreignField: "movieId",
				pipeline: [
					{
						$match: {
							userId: req.user._id,
							isBookmark: true,
						},
					},
					{ $sort: { updatedAt: -1 } },
				],
				as: "bookmark",
			},
		},
		{ $unwind: "$bookmark" },
	];

	try {
		Movie.aggregate(
			[
				{
					$facet: {
						totalSize: [
							...lookup,
							{
								$group: {
									_id: null,
									count: { $sum: 1 },
								},
							},
							{ $project: { _id: false } },
							{ $limit: 1 },
						],
						items: [
							...lookup,
							...movieOperations({
								addToProject: {
									poster: { src: true },
									addedToBookmarkAt: "$bookmark.updatedAt",
								},
								skip,
								limit,
							}),
							{ $sort: { addedToBookmarkAt: -1 } },
						],
					},
				},
				{ $unwind: { path: "$totalSize", preserveNullAndEmptyArrays: true } },
				{
					$project: {
						totalSize: { $cond: ["$totalSize.count", "$totalSize.count", 0] },
						items: "$items",
					},
				},
			],
			(err, result) => {
				return res.status(200).json(result[0]);
			},
		);
	} catch (err) {
		return resError({ res, msg: err });
	}
});

module.exports = router;
