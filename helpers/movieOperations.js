const movieOperations = ({ 
	addToMatch, 
	addToProject,
	sort = { createdAt: -1 },
	limit = 10000,
	skip = 0,
	matchRating = {}
}) => {

	const match = { publishedAt: { $ne: null } };
	const lookupFromCategories = {
		from: "categories",
		localField: "categoryAlias",
		foreignField: "alias",
		let: { genresAliases: "$genresAliases" },
		pipeline: [
			{ $project: {
				_id: false,
				genres: {
					$map: {
						"input": "$$genresAliases",
						"as": "this",
						"in": {
							$first: {
								$filter: {
									input: "$genres",
									as: "genres",
									cond: { $eq: [ "$$genres.alias", "$$this" ] },
								}
							}
						},
					}

				}
			} }
		],
		as: "category"
	};
	const lookupFromMovieRatings = {
		from: "movieratings",
		localField: "_id",
		foreignField: "movieId",
		pipeline: [
			{ $match: matchRating },
			{ $group: { 
				_id: null,
				avg: { $avg: "$rating" } 
			} }
		],
		as: "rating"
	};
	const project = {
		_id: true,
		name: true,
		badge: true,
		ageLevel: true,
		dateReleased: true,
		rating: "$rating.avg",
		categoryAlias: true,
		duration: {
			$switch: {
				branches: [
					{ case: { $eq: ["$categoryAlias", "films"] }, then: {
						$sum: {
							$map: {
								"input": "$films",
								"as": "item",
								"in": "$$item.duration"
							}
						},
			   		} },
					{ case: { $eq: ["$categoryAlias", "serials"] }, then: {
						$sum: {
							$map: {
								"input": "$series",
								"as": "seasons",
								"in": {
									$sum: {
										$map: {
											"input": "$$seasons",
											"as": "item",
											"in": "$$item.duration"
										}
									}
								}
							}
						},
				   } }
				],
				default: 0
			}
		},
		url: { $concat: [ "/p/", "$alias" ] },
	};

	return [
		{ $match: { 
			...match,
			...addToMatch
		} },
		{ $lookup: lookupFromCategories },
		{ $unwind: "$category" },
		{ $lookup: lookupFromMovieRatings },
		{ $sort: sort },
		{ $unwind: { path: "$rating", preserveNullAndEmptyArrays: !Object.keys(matchRating).length } },
		{ $addFields: { genres: "$category.genres" } },
		{ $project: {
			...project,
			...addToProject
		} },
		{ $skip: skip },
		{ $limit: limit },
	];

};

module.exports = movieOperations;
