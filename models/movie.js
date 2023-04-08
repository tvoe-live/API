const mongoose = require('mongoose');

const movieSchema = new mongoose.Schema({
	name: String, // Название
	origName: String, // Оригинальное название
	shortDesc: String, // Краткое описание
	fullDesc: String, // Полное описание
	alias: String, // Сгенерированный ЧПУ
	ageLevel: Number, // Возрастное ограничение
	dateReleased: String, // Дата выпуска
	countries: [String], // Страны (Названия)
	duration: String, // Длительность
	categoryAlias: String, // Категория
	genresAliases: [String], // Жанры
	persons: [{ // Актёры и съемочная группа
		name: String, // Имя и фамилия
		type: String // director - режиссер, actor - актер, producer - продюсер, screenwriter - сценарист, operator - оператор
	}],
	badge: { // Бейдж
		type: String, // newSeason - новый сезон, premiere - премьера
		startAt: Date,
		finishAt: Date
	},
	logo: { // Обложка
		_id: mongoose.Schema.Types.ObjectId,
		src: String
	},
	cover: { // Обложка
		_id: mongoose.Schema.Types.ObjectId,
		src: String
	},
	poster: { // Постер
		_id: mongoose.Schema.Types.ObjectId,
		src: String
	},
	trailer: { // Трейлер
		_id: mongoose.Schema.Types.ObjectId,
		src: String,
		width: Number,
		height: Number,
		duration: Number,
		thumbnail: String
	},
	films: [{ // Фильмы
		_id: mongoose.Schema.Types.ObjectId,
		src: String,
		width: Number,
		height: Number,
		duration: Number,
		thumbnail: String
	}],
	series: [ // Сезоны
		[{ // Серии
			_id: mongoose.Schema.Types.ObjectId,
			src: String,
			name: String,
			width: Number,
			height: Number,
			duration: Number,
			thumbnail: String
		}]
	],
	deletedAt: Date,
	publishedAt: Date,
	creatorUserId: mongoose.Schema.Types.ObjectId
}, {
	typeKey: "$type",
	timestamps: true
})

module.exports = mongoose.model('Movie', movieSchema)