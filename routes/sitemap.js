const { DOMAIN } = process.env;
const express = require('express');
const router = express.Router();
const xml = require('xml');
const Movie = require('../models/movie');
const resError = require('../helpers/resError');
const getCatalogPages = require('../helpers/getCatalogPages');

/*
 * Данные для sitemap.xml
 */

// Получение списка всех ссылок
router.get('/', async (req, res) => {

	try {
		const sitemapUrls = [];

		const movies = await Movie.aggregate([
			{ $match: { publishedAt: { $ne: null } } },
			{ 
				$lookup: {
					from: "categories",
					localField: "categoryAlias",
					foreignField: "alias",
					as: "category"
				}
			},
			{ $unwind: "$category" },
			{ $sort : { _id : -1 } },
			{ "$project": {
				_id: false,
				alias: true,
				updatedAt: true,
				category: {
					aliasInUrl: true
				}
			} }
		]);

		const catalogPages = await getCatalogPages({});

		movies.map(item => {
			sitemapUrls.push({
				url: [
					{ priority: 0.8 },
					{ changefreq: 'weekly' },
					{ loc: `${DOMAIN}/p/${item.alias}` },
					{ lastmod: new Date(item.updatedAt).toISOString().split("T")[0] }
				]
			})
		});

		catalogPages.reverse().map(item => {
			let base = [ item.categoryAlias]

			if(item.genreAlias) base.push(item.genreAlias)
			if(item.dateReleased) base.push(item.dateReleased)

			base = base.join('/')
			
			const loc = new URL(base, DOMAIN)

			sitemapUrls.push({
				url: [
					{ priority: 0.9 },
					{ changefreq: 'daily' },
					{ loc: loc.href }
				]
			})
		});

		sitemapUrls.push({
			url: [
				{ priority: 1},
				{ changefreq: 'always' },
				{ loc: DOMAIN }
			]
		})

		const sitemap = `
<?xml version="1.0" encoding="UTF-8"?>
<urlset 
	xmlns="http://www.sitemaps.org/schemas/sitemap/0.9" 
	xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance" 
	xsi:schemaLocation="http://www.sitemaps.org/schemas/sitemap/0.9 http://www.sitemaps.org/schemas/sitemap/0.9/sitemap.xsd"
>
${xml(sitemapUrls, true)}
</urlset>`.trim();

		res.setHeader('Content-Type', 'text/xml')
		
		return res.status(200).send(sitemap);

	} catch(err) {
		return resError({ res, msg: err });
	}
});

module.exports = router;