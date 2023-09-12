const express = require("express");
const router = express.Router();

// Если пути не найдены возвращает ошибку 404
router.use("*", (req, res) => {
	res.status(404).json({
		type: "error",
		message: "Путь не найден",
		error: {
			statusCode: 404,
			message: "Такого пути на сервере не существует",
		},
	});
});

module.exports = router;
