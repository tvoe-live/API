const Movie = require("../models/movie");
const movieOperations = require("../helpers/movieOperations");

class CollectionsRepository {
    static  getCollections() {
        return Movie.aggregate([
            { $facet: {
                    // Карусель - самые популярные
                    "carousel": [
                        { $lookup: {
                                from: "moviepagelogs",
                                localField: "_id",
                                foreignField: "movieId",
                                pipeline: [
                                    { $match: {
                                            updatedAt: {
                                                $gte: new Date(new Date() - 3 * 60 * 60 * 24 * 1000)
                                            }
                                        } },
                                    { $group: {
                                            _id: '$userId',
                                            items: {
                                                $push: '$$ROOT',
                                            }
                                        } },
                                    { $project: {
                                            _id: true
                                        } }
                                ],
                                as: "countPageViewed"
                            } },
                        ...movieOperations({
                            addToProject: {
                                logo: true,
                                cover: { src: true },
                                genreName: { $first: "$genres.name" },
                                countPageViewed: { $size: "$countPageViewed" },
                            },
                            sort: { countPageViewed: -1, publishedAt: -1 },
                            limit: 32
                        }),
                        { $project: {
                                countPageViewed: false
                            } }
                    ],

                    // Новинки
                    "new": [
                        ...movieOperations({
                            addToProject: {
                                poster: { src: true }
                            },
                            limit: 24
                        }),
                        { $project: {
                                genres: false,
                                ageLevel: false,
                                dateReleased: false,
                                categoryAlias: false,
                            } }
                    ],

                    // Жанры
                    "genres": [
                        { $lookup: {
                                from: "moviepagelogs",
                                localField: "_id",
                                foreignField: "movieId",
                                pipeline: [
                                    { $match: {
                                            updatedAt: {
                                                $gte: new Date(new Date() - 5 * 60 * 60 * 24 * 1000)
                                            }
                                        } },
                                    { $group: {
                                            _id: '$userId',
                                            items: {
                                                $push: '$$ROOT',
                                            }
                                        } },
                                    { $project: {
                                            _id: true
                                        } }
                                ],
                                as: "countPageViewed"
                            } },
                        ...movieOperations({
                            addToProject: {
                                poster: { src: true },
                                genres: { $first: "$genres" },
                                countPageViewed: { $size: "$countPageViewed" },
                                sort: { publishedAt: -1 },
                            },
                        }),
                        { $unwind: { path: "$genres" } },
                        { $group: {
                                _id: '$genres',
                                items: {
                                    $push: '$$ROOT',
                                },
                                countPageViewed: { $sum: "$countPageViewed" },
                            }
                        },
                        { $sort: { countPageViewed: -1 } },
                        { $project: {
                                _id: false,
                                name: "$_id.name",
                                items: "$items",
                                url: { $concat: [ "/collections/", "$_id.alias" ] },
                            } },
                        { $project: {
                                items: {
                                    genres: false,
                                    ageLevel: false,
                                    dateReleased: false,
                                    categoryAlias: false,
                                    countPageViewed: false
                                }
                            } }
                    ]
                } },
            { $project: {
                    collections: [
                        {
                            type: "carousel",
                            items: "$carousel"
                        },
                        {
                            name: "Новинки",
                            items: "$new"
                        }
                    ],
                    genres: "$genres"
                } },
        ]);
    }
}

module.exports = CollectionsRepository;