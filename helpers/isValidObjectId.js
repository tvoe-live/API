const mongoose = require('mongoose')

function isValidObjectId(id) {
	if (mongoose.Types.ObjectId.isValid(id)) {
		if (String(new mongoose.Types.ObjectId(id)) === id) return true
		return false
	}
	return false
}

module.exports = isValidObjectId
