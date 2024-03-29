const fs = require('fs')
require('dotenv').config()
const path = require('path')
const cors = require('cors')
const yaml = require('js-yaml')
const express = require('express')
const mongoose = require('mongoose')
const bodyParser = require('body-parser')
const verify = require('./middlewares/verify')
const expressUseragent = require('express-useragent')

// Cron-задачи
const { Tasks } = require('./tasks/createTask')
const resetOldSession = require('./tasks/resetOldSession')
const resetMovieBadge = require('./tasks/resetMovieBadge')
const recurrentPayment = require('./tasks/reccurentPayment')

const { PORT, DATABASE_URL } = process.env

mongoose.set('strictQuery', false)
mongoose.connect(DATABASE_URL)
const database = mongoose.connection

database.on('error', (error) => console.log(error))
database.once('connected', () => console.log('Database Connected'))
process.on('uncaughtException', (exception) => console.log(`ERROR:`, exception))

const app = express()
app.set('trust proxy', true)

app.use(
	cors({
		origin: true,
		credentials: true,
	})
)
app.use(express.json())
app.use(expressUseragent.express())
app.use(
	bodyParser.urlencoded({
		extended: true,
	})
)

const auth = require('./routes/auth')
const admin = require('./routes/admin')
const search = require('./routes/search')
const movies = require('./routes/movies')
const catalog = require('./routes/catalog')
const payment = require('./routes/payment')
const sitemap = require('./routes/sitemap')
const profile = require('./routes/profile')
const notFound = require('./routes/notFound')
const referral = require('./routes/referral')
const promocodes = require('./routes/promocodes')
const complaints = require('./routes/complaints')
const adminUsers = require('./routes/admin/users')
const collections = require('./routes/collections')
const adminMovies = require('./routes/admin/movies')
const adminPayment = require('./routes/admin/payment')
const adminReferral = require('./routes/admin/referral')
const profilePayment = require('./routes/profile/payment')
const profileDevices = require('./routes/profile/devices')
const profileHistory = require('./routes/profile/history')
const adminPromocodes = require('./routes/admin/promocodes')
const adminMovieEditor = require('./routes/admin/movieEditor')
const profileFavorites = require('./routes/profile/favorites')
const profileBookmarks = require('./routes/profile/bookmarks')
const profileWithdrawal = require('./routes/profile/withdrawal')
const adminNotifications = require('./routes/admin/notification')
const adminSearchHistory = require('./routes/admin/searchHistory')
const profileNotifications = require('./routes/profile/notifications')
const adminMoviesRatingHistory = require('./routes/admin/moviesRatingHistory')
const adminMoviesViewingHistory = require('./routes/admin/moviesViewingHistory')

app.use('/auth', auth) // Авторизация / регистрация через Яндекс и разрушение сессии
app.use('/movies', movies) // Фильмы и сериалы
app.use('/search', search) // Поиск
app.use('/payment', payment) // Тарифы, создание и обработка платежей
app.use('/sitemap', sitemap) // Данные для sitemap.xml
app.use('/catalog', catalog) // Фильмы / сериалы с фильтром
app.use('/referral', referral) // Реферальная программа
app.use('/promocodes', promocodes) // Промокоды
app.use('/complaints', complaints) // Жалобы
app.use('/collections', collections) // Подборки и жанры для главной страницы

app.use('/profile', profile) // Профиль
app.use('/profile/payment', profilePayment) // Профиль > Подписка
app.use('/profile/devices', profileDevices) // Профиль > Мои устройства
app.use('/profile/history', profileHistory) // Моё > История просмотров
app.use('/profile/favorites', profileFavorites) // Моё > Избранное
app.use('/profile/bookmarks', profileBookmarks) // Моё > Закладки
app.use('/profile/withdrawal', profileWithdrawal) // Профиль > Журнал заявок на возврат денежных средств
app.use('/profile/notifications', profileNotifications) // Навигация > Уведомления

app.use('/admin', admin) // Админ-панель
app.use('/admin/users', adminUsers) // Админ-панель > Пользователи
app.use('/admin/movies', adminMovies) // Админ-панель > Фильмы и сериалы
app.use('/admin/payment', adminPayment) // Админ-панель > История пополнений
app.use('/admin/referral', adminReferral) // Админ-панель > Реферальная программа
app.use('/admin/promocodes', adminPromocodes) // Админ-панель > Промокоды
app.use('/admin/movieEditor', adminMovieEditor) // Админ-панель > Редактор медиа страницы
app.use('/admin/searchHistory', adminSearchHistory) // Админ-панель > История поиска
app.use('/admin/notifications', adminNotifications) // Админ-панель > Уведомления
app.use('/admin/moviesRatingHistory', adminMoviesRatingHistory) // Админ-панель > История рейтингов
app.use('/admin/moviesViewingHistory', adminMoviesViewingHistory) // Админ-панель > История просмотров

// Работа со сваггером
const data = fs.readFileSync('swagger/docs.yml', 'utf8')
const yamlData = yaml.load(data)
const jsonData = JSON.stringify(yamlData)
fs.writeFileSync('./swagger/docs.json', jsonData, 'utf8')
const swagger = express.static(path.join(__dirname, 'swagger'))

app.use(verify.token, verify.isAdmin, swagger) // Техническая документация /docs.json
app.use('*', notFound) // 404 - Обработка несуществующих страниц

app.listen(PORT, () => {
	console.log(`Server Started at ${PORT}`)

	Tasks.restart('resetMovieBadge', resetMovieBadge) // Сброс бейджев фильмов/сериалов
	Tasks.restart('resetOldSession', resetOldSession) // Сброс сессий пользователей
	Tasks.restart('reccurentPayment', recurrentPayment) // Создание рекуррентных платежей
})
