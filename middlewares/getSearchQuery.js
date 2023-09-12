//const resError = require("../helpers/resError");

const getSearchQuery = async (req, res, next) => {
	let query;

	if (req.query.query) query = req.query.query;
	if (req.body.query) query = req.body.query;

	if (query && query.length) {
		query = query.toString();
		query = query.trim();
		query = query.replace(/\s+/g, " ");

		req.searchQuery = query;
		req.RegExpQuery = new RegExp(query, "i");
	}

	next();
};

module.exports = getSearchQuery;
