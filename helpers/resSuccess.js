const resSuccess = ({ res, ...params }) => {

	return res.status(200).json({
		type: 'success',
		...params
	});
};

module.exports = resSuccess;
