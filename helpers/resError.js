const resError = ({ res, msg, alert }) => {
	let params = msg

	if (msg.name === 'CastError' || msg.ok === 0) params = { data: msg }

	if ((typeof msg !== 'object' && !Array.isArray(msg)) || msg !== null) {
		params = { msg: msg.toString() }
	}

	return res.status(200).json({
		alert,
		type: 'error',
		...params,
	})
}

module.exports = resError
