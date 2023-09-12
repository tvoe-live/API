const { CLIENT_URL } = process.env;
const express = require("express");
const router = express.Router();
const xml = require("xml");
const Movie = require("../models/movie");
const resError = require("../helpers/resError");
const getCatalogPages = require("../helpers/getCatalogPages");

/*
 * Данные для sitemap.xml
 */

// Получение списка всех ссылок
router.get("/", async (req, res) => {
	try {
		const sitemapUrls = [];

		const movies = await Movie.aggregate([
			{ $match: { publishedAt: { $ne: null } } },
			{
				$lookup: {
					from: "categories",
					localField: "categoryAlias",
					foreignField: "alias",
					as: "category",
				},
			},
			{ $unwind: "$category" },
			{ $sort: { _id: -1 } },
			{
				$project: {
					_id: false,
					alias: true,
					updatedAt: true,
					category: {
						aliasInUrl: true,
					},
				},
			},
			{ $limit: 49000 },
		]);

		const catalogPages = await getCatalogPages({});

		movies.forEach((item) => {
			const existMovie = sitemapUrls.find(
				(obj) => obj.url[2].loc === `${CLIENT_URL}/p/${item.alias}`,
			);

			if (!existMovie) {
				sitemapUrls.push({
					url: [
						{ priority: 0.8 },
						{ changefreq: "weekly" },
						{ loc: `${CLIENT_URL}/p/${item.alias}` },
						{ lastmod: new Date(item.updatedAt).toISOString().split("T")[0] },
					],
				});
			}
		});

		catalogPages.reverse().forEach((item) => {
			let base = [item.categoryAlias];

			if (item.genreAlias) base.push(item.genreAlias);
			if (item.dateReleased) base.push(item.dateReleased);

			base = base.join("/");

			const loc = new URL(base, CLIENT_URL);

			const existMovie = sitemapUrls.find((obj) => obj.url[2].loc === loc.href);
			if (!existMovie) {
				sitemapUrls.push({
					url: [{ priority: 0.9 }, { changefreq: "daily" }, { loc: loc.href }],
				});
			}
		});

		sitemapUrls.push({
			url: [{ priority: 1 }, { changefreq: "always" }, { loc: CLIENT_URL }],
		});

		const sitemap = `
<?xml version="1.0" encoding="UTF-8"?>
<urlset
	xmlns="http://www.sitemaps.org/schemas/sitemap/0.9"
	xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"
	xsi:schemaLocation="http://www.sitemaps.org/schemas/sitemap/0.9 http://www.sitemaps.org/schemas/sitemap/0.9/sitemap.xsd"
>
${xml(sitemapUrls, true)}
</urlset>`.trim();

		res.setHeader("Content-Type", "text/xml");

		return res.status(200).send(sitemap);
	} catch (err) {
		return resError({ res, msg: err });
	}
});

module.exports = router;
