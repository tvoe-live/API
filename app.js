const fs = require('fs')
const path = require('path')
require('dotenv').config()
const cors = require('cors')
const express = require('express')
const mongoose = require('mongoose')
const requestIp = require('request-ip')
const bodyParser = require('body-parser')
const expressUseragent = require('express-useragent')
const yaml = require('js-yaml')
const swaggerUi = require('swagger-ui-express')
const verify = require('./middlewares/verify')
const { Tasks } = require('./helpers/createTask')
const upMovieTask = require('./helpers/upMovieTask')
const repaymentTask = require('./helpers/repaymentTask')
const recurrentPayment = require('./helpers/reccurentPayment')
const subscribeRouter = require('./routes/profile/changeAutopayment')
const refferalRouter = require('./routes/profile/refferal')
const refferalLinkRouter = require('./routes/refferalLink')

const { PORT, STATIC_DIR, IMAGES_DIR, VIDEOS_DIR, DATABASE_URL } = process.env

mongoose.set('strictQuery', false)
mongoose.connect(DATABASE_URL)
const database = mongoose.connection

database.on('error', (error) => console.log(error))
database.once('connected', () => console.log('Database Connected'))
process.on('uncaughtException', (exception) => console.log(`ERROR:`, exception))

const app = express()
app.use(requestIp.mw())

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

if (process.env.NODE_ENV !== 'production') {
	app.use('/images', express.static(STATIC_DIR + IMAGES_DIR))
	app.use('/videos', express.static(STATIC_DIR + VIDEOS_DIR))

	// Создание директории статических файлов
	if (!fs.existsSync(STATIC_DIR + IMAGES_DIR))
		fs.mkdirSync(STATIC_DIR + IMAGES_DIR, { recursive: true })
	if (!fs.existsSync(STATIC_DIR + VIDEOS_DIR))
		fs.mkdirSync(STATIC_DIR + VIDEOS_DIR, { recursive: true })
}

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
app.use('/link', refferalLinkRouter) // Реферальные ссылки
app.use('/collections', collections) // Подборки и жанры для главной страницы

app.use('/profile', profile) // Профиль
app.use('/profile/payment', profilePayment) // Профиль > Подписка
app.use('/profile/devices', profileDevices) // Профиль > Мои устройства
app.use('/profile/history', profileHistory) // Моё > История просмотров
app.use('/profile/refferal', refferalRouter) // Профиль > статистика по реферальной программе
app.use('/profile/favorites', profileFavorites) // Моё > Избранное
app.use('/profile/bookmarks', profileBookmarks) // Моё > Закладки
app.use('/profile/autopayment', subscribeRouter) // Управление автоплатежами
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
const data = fs.readFileSync('swagger/doc.yml', 'utf8')
const yamlData = yaml.load(data)
const jsonData = JSON.stringify(yamlData)
fs.writeFileSync('./swagger/doc.json', jsonData, 'utf8')
const swaggerJson = require('./swagger/doc.json')
app.use('/admin/docs', verify.token, verify.isAdmin, swaggerUi.serve, swaggerUi.setup(swaggerJson))

app.use(verify.token, verify.isAdmin, express.static(path.join(__dirname, 'swagger')))
app.use('*', notFound)

app.listen(PORT, () => {
	console.log(`Server Started at ${PORT}`)
	Tasks.restart('reccurentPayment', recurrentPayment)
	Tasks.restart('repayment', repaymentTask)
	Tasks.restart('upMovie', upMovieTask)
})
