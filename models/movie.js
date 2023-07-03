const mongoose = require('mongoose');

const videoSchema = {
	_id: mongoose.Schema.Types.ObjectId,
	src: String, // Путь к видео
	duration: Number, // Продолжительность видео в секундах
	qualities: [String], // Доступные качества видео
	audio: [String], // Названия аудиодорожек
	subtitles: [String], // Названия субтитров
	thumbnail: String, // Путь к миниатюре
	fragments: { // Количество TS-фрагментов
		qualities: Object,
		audio: [Number]
	},
	thumbnails: Number, // Количество склеек миниатюр
	status: String, // uploading - загрузка, removing - удаление, ready - готов
	progress: { // Прогресс загрузки
		total: Number, // Всего файлов нужно загрузить
		done: Number // Сколько файлов загружено
	}
}

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
	series: [[Object]],
	raisedUpAt: Date, // Дата поднятия в списке (для актуальности)
	deletedAt: Date, // Дата удаления
	publishedAt: Date, // Дата публикации
	creatorUserId: mongoose.Schema.Types.ObjectId, // ID создателя 
}, {
	typeKey: "$type",
	timestamps: true
})

module.exports = mongoose.model('Movie', movieSchema)