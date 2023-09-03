const movieOperations = ({
	addToMatch,
	addToProject,
	sort = { createdAt: -1 },
	limit = 10000,
	skip = 0
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
	const project = {
		_id: true,
		name: true,
		badge: true,
		rating: true,
		ageLevel: true,
		dateReleased: true,
		categoryAlias: true,
		trailer:true,
		series: {
			$cond: {
			  if: { $eq: ["$categoryAlias", "serials"] },
			  then:  '$series',
			  else: "$$REMOVE"
			}
		},
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
		{ $sort: sort },
		{ $addFields: { genres: "$category.genres" } },
		{ $project: {
			...project,
			...addToProject,
		} },
		{ $skip: skip },
		{ $limit: limit },
	];

};

module.exports = movieOperations;
