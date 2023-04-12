const express = require('express');
const router = express.Router();
const service = require('../service/collections');
const resError = require('../helpers/resError');

/*
 * Подборки и жанры для главной страницы
 */

router.get('/', async (req, res) => {

	try {
		const  collectionsFiltered = await service.getCollections();
		return res.status(200).json(collectionsFiltered);

	} catch(err) {
		return resError({ res, msg: err });
	}
});

module.exports = router;