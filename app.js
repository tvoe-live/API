const fs = require('fs');
require('dotenv').config();
const cors = require('cors');
const express = require('express');
const mongoose = require('mongoose');
const bodyParser = require('body-parser');
const expressUseragent = require('express-useragent');
const {
	PORT,
	TMP_DIR,
	STATIC_DIR,
	IMAGES_DIR,
	VIDEOS_DIR,
	DATABASE_URL
} = process.env;

mongoose.set('strictQuery', false);
mongoose.connect(DATABASE_URL);
const database = mongoose.connection;

database.on('error', (error) => console.log(error))
database.once('connected', () => console.log('Database Connected'))
process.on('uncaughtException', (exception) => console.log(`ERROR:`, exception));

const app = express();
app.set('trust proxy', true);
app.use(cors({
	origin: true,
	credentials: true
}));
app.use(express.json());
app.use(expressUseragent.express())
app.use(bodyParser.urlencoded({
	extended: true,
}));

if(process.env.NODE_ENV !== 'production') {
	app.use('/images', express.static(STATIC_DIR + IMAGES_DIR));
	app.use('/videos', express.static(STATIC_DIR + VIDEOS_DIR));

	// Создание директорий, если не существует
	if(!fs.existsSync(TMP_DIR)) fs.mkdirSync(TMP_DIR, { recursive: true });
	//if(!fs.existsSync(STATIC_DIR + IMAGES_DIR)) fs.mkdirSync(STATIC_DIR + IMAGES_DIR, { recursive: true });
	//if(!fs.existsSync(STATIC_DIR + VIDEOS_DIR)) fs.mkdirSync(STATIC_DIR + VIDEOS_DIR, { recursive: true });
}

const auth = require('./routes/auth');
const admin = require('./routes/admin');
const search = require('./routes/search');
const movies = require('./routes/movies');
const catalog = require('./routes/catalog');
const payment = require('./routes/payment');
const sitemap = require('./routes/sitemap');
const profile = require('./routes/profile');
const notFound = require('./routes/notFound');
const adminUsers = require('./routes/admin/users');
const collections = require('./routes/collections');
const adminMovies = require('./routes/admin/movies');
const adminPayment = require('./routes/admin/payment');
const profilePayment = require('./routes/profile/payment');
const profileDevices = require('./routes/profile/devices');
const profileHistory = require('./routes/profile/history');
const adminMovieEditor= require('./routes/admin/movieEditor');
const profileFavorites = require('./routes/profile/favorites');
const adminSearchHistory = require('./routes/admin/searchHistory');
const adminMoviesRatingHistory = require('./routes/admin/moviesRatingHistory');
const adminMoviesViewingHistory = require('./routes/admin/moviesViewingHistory');

app.use('/auth', auth) // Авторизация / регистрация через Яндекс и разрушение сессии
app.use('/movies', movies) // Фильмы и сериалы
app.use('/search', search) // Поиск
app.use('/payment', payment) // Тарифы, создание и обработка платежей
app.use('/sitemap', sitemap) // Данные для sitemap.xml
app.use('/catalog', catalog) // Фильмы / сериалы с фильтром
app.use('/collections', collections) // Подборки и жанры для главной страницы

app.use('/profile', profile) // Профиль
app.use('/profile/payment', profilePayment) // Профиль > Подписка
app.use('/profile/devices', profileDevices) // Профиль > Мои устройства
app.use('/profile/history', profileHistory) // Профиль > История просмотров
app.use('/profile/favorites', profileFavorites) // Профиль > Избранное

app.use('/admin', admin) // Админ-панель
app.use('/admin/users', adminUsers) // Админ-панель > Пользователи
app.use('/admin/movies', adminMovies) // Админ-панель > Фильмы и сериалы
app.use('/admin/payment', adminPayment) // Админ-панель > История пополнений
app.use('/admin/movieEditor', adminMovieEditor) // Админ-панель > Редактор медиа страницы
app.use('/admin/searchHistory', adminSearchHistory) // Админ-панель > История поиска
app.use('/admin/moviesRatingHistory', adminMoviesRatingHistory) // Админ-панель > История рейтингов
app.use('/admin/moviesViewingHistory', adminMoviesViewingHistory) // Админ-панель > История просмотров

app.use('*', notFound)

app.listen(PORT, () => console.log(`Server Started at ${PORT}`))