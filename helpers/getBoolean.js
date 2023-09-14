const getBoolean = (value, defaultValue = undefined) => {
	if (!value) return defaultValue
	return Boolean(JSON.parse(value.toString()))
}

module.exports = getBoolean
