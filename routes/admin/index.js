const express = require('express');
const router = express.Router();
const Category = require('../../models/category');
const verify = require('../../middlewares/verify');

/*
 * Админ-панель > Основное
 */

// Кол-во фильмов
// Кол-во сериалов
// Кол-во пользователей
// Кол-во просмотров фильмов / серий
// Кол-во оценок
// Кол-во запросов в поиск

router.get('/', verify.token, verify.isManager, async (req, res) => {
	
});

router.get('/categories', async (req, res) => {
	try {
		const categories = await Category.find({}, {
			_id: false,
			name: true, 
			alias: true,
			aliasInUrl: true,
			genres: {
				name: true,
				alias: true
			}
		});

		return res.status(200).json( categories );
	} catch (error) {
		return res.json(error);
	}
});


module.exports = router;