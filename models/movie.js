const mongoose = require('mongoose');

const videoSchema = new mongoose.Schema({
	_id: mongoose.Schema.Types.ObjectId,
	src: String,
	duration: Number,
	qualities: Array,
	thumbnail: String
})

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
	trailer: videoSchema, // Трейлер
	films: [videoSchema], // Фильмы
	series: [ // Сезоны
		[videoSchema] // Серии
	],
	raisedUpAt: Date, // Дата поднятия в списке (для актуальности)
	deletedAt: Date, // Дата удаления
	publishedAt: Date, // Дата публикации
	creatorUserId: mongoose.Schema.Types.ObjectId // ID создателя 
}, {
	typeKey: "$type",
	timestamps: true
})

module.exports = mongoose.model('Movie', movieSchema)