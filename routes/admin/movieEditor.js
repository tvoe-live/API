const { S3_UPLOAD_KEY, S3_UPLOAD_SECRET, S3_UPLOAD_REGION, S3_UPLOAD_BUCKET, S3_UPLOAD_ENDPOINT } =
	process.env
const express = require('express')
const router = express.Router()
const multer = require('multer')
const mongoose = require('mongoose')
const Movie = require('../../models/movie')
const verify = require('../../middlewares/verify')
const resError = require('../../helpers/resError')
const CleanupLog = require('../../models/cleanupLog')
const resSuccess = require('../../helpers/resSuccess')
const { uploadImageToS3 } = require('../../helpers/uploadImage')
const { deleteFileFromS3, deleteFolderFromS3 } = require('../../helpers/deleteFile')
const schedule = require('node-schedule')

/*
 * Админ-панель > Редактор медиа страницы
 */

// Получение уникального ID от базы данных
const getObjectId = () => new mongoose.Types.ObjectId()

// Загрузка картинок в буффер
const memoryStorage = multer.memoryStorage()
const uploadMemoryStorage = multer({ storage: memoryStorage })

/*
 * Создание медиа страницы, если ее не существует
 */
const existMovie = async (req, res, next) => {
	const { movieId } = req.body

	if (movieId) return next()

	const newMovie = await Movie.create({
		raisedUpAt: new Date(),
		creatorUserId: req.user._id,
	})

	req.body.movieId = newMovie._id

	next()
}

// Если нельзя удалить видео, то выдать ошибку, иначе удалить
const cannotBeDeleted = (req, video) => {
	if (!video || !video._id || !video.status) return false

	if (
		!video.managerUserId ||
		video.status === 'READY' ||
		req.user._id.toString() === video.managerUserId.toString()
	) {
		deleteVideoExecute(video)
		return false
	}

	return true
}

// Удаление видео
const deleteVideoExecute = async (video, createLog = true) => {
	const { src, thumbnail } = video
	let _id

	// Внести ресурсы в базу удалений
	if (createLog) {
		const item = await CleanupLog.create({ src, thumbnail })
		_id = item._id
	} else {
		_id = video._id
	}

	try {
		if (src) await deleteFolderFromS3(src)
		if (thumbnail) await deleteFileFromS3(thumbnail)
	} catch {}

	// Через 5 минут проверить удаление
	setTimeout(async () => {
		try {
			if (src) await deleteFolderFromS3(src)
			if (thumbnail) await deleteFileFromS3(thumbnail)
		} catch {}

		// Удалить ресурсы из базы, так как они уже наверняка удалены с S3
		await CleanupLog.deleteOne({ _id })
	}, 300000)
}

/*
 * Получить данные для клиента S3
 */
router.get('/s3data', verify.token, verify.isManager, async (req, res) => {
	return res.status(200).json({
		S3_UPLOAD_KEY,
		S3_UPLOAD_SECRET,
		S3_UPLOAD_REGION,
		S3_UPLOAD_BUCKET,
		S3_UPLOAD_ENDPOINT,
	})
})

/*
 * Загрузка обложки, постера или логотипа
 */
router.post(
	'/image',
	verify.token,
	verify.isManager,
	uploadMemoryStorage.single('file'),
	existMovie,
	async (req, res) => {
		if (!req.file || !req.file.buffer) {
			return resError({
				res,
				alert: true,
				msg: 'Не получена картинка',
			})
		}

		const { movieId, name } = req.body
		const { buffer } = req.file

		try {
			const { fileId, fileSrc } = await uploadImageToS3({
				res,
				buffer,
				type: name === 'logo' ? 'png' : 'jpg',
			})

			// Добавление / обновление ссылки на фаил в БД
			const movie = await Movie.findOneAndUpdate(
				{ _id: movieId },
				{
					$set: {
						[name]: {
							_id: fileId,
							src: fileSrc,
						},
					},
				}
			)

			// Удаление старого файла
			const pathToOldFile = movie[name].src
			if (pathToOldFile) await deleteFileFromS3(pathToOldFile)

			return resSuccess({
				res,
				movieId,
				alert: true,
				_id: fileId,
				src: fileSrc,
				msg: 'Успешно сохранено',
			})
		} catch (err) {
			return resError({ res, msg: err })
		}
	}
)

/*
 * Загрузка видео и миниатюры
 */
router.post('/video', verify.token, verify.isManager, existMovie, async (req, res) => {
	const {
		movieId,
		name,
		version,
		duration,
		qualities,
		audio,
		subtitles,
		files,
		seasonKey,
		episodeKey,
		isReady,
	} = req.body

	try {
		const movie = await Movie.findOne({ _id: movieId })
		if (
			(name === 'series' && movie.categoryAlias != 'serials') ||
			(name === 'films' && movie.categoryAlias != 'films')
		) {
			return resError({
				res,
				alert: true,
				msg: 'Категория страницы была изменена',
			})
		}

		// Если нужно закрыть загрузку файла
		if (isReady) {
			let path, videoParams

			switch (name) {
				case 'trailer':
					if (!movie.trailer) {
						return resError({
							res,
							alert: true,
							msg: 'Трейлера не существует',
						})
					}

					path = 'trailer'
					videoParams = movie.trailer
					break
				case 'films':
					if (!movie.films || !movie.films[0]) {
						return resError({
							res,
							alert: true,
							msg: 'Фильма не существует',
						})
					}

					path = 'films.0'
					videoParams = movie.films[0]
					break
				case 'series':
					if (!movie.series || !movie.series[seasonKey] || !movie.series[seasonKey][episodeKey]) {
						return resError({
							res,
							alert: true,
							msg: 'Серии не существует',
						})
					}

					path = `series.${seasonKey}.${episodeKey}`
					videoParams = movie.series[seasonKey][episodeKey]
			}

			// Изменить статус на 'READY'
			await Movie.updateOne(
				{ _id: movieId },
				{
					$set: {
						[`${path}.status`]: 'READY',
						[`${path}.lastUpdateAt`]: Date.now(),
					},
				}
			)

			return resSuccess({
				res,
				movieId,
				isReady,
				...videoParams,
			})
		}

		const videoParams = {
			_id: getObjectId(),
			src: `/videos/${getObjectId()}`,
			thumbnail: `/images/${getObjectId()}.jpg`,
			version,
			duration,
			qualities,
			audio,
			subtitles,
			files,
			status: 'UPLOADING',
			managerUserId: req.user._id,
			lastUpdateAt: Date.now(),
		}

		const updateOptions = {}

		const notEnoughRights = () =>
			resError({
				res,
				alert: true,
				msg: 'Недостаточно прав',
			})

		switch (name) {
			case 'trailer':
				if (cannotBeDeleted(req, movie.trailer)) {
					return notEnoughRights()
				}

				updateOptions.$set = { trailer: videoParams }
				break
			case 'films':
				if (movie.films) {
					if (cannotBeDeleted(req, movie.films[0])) {
						return notEnoughRights()
					}

					if (movie.films.length) {
						updateOptions.$set = { 'films.0': videoParams }
						break
					}
				}

				updateOptions.$push = { films: videoParams }
				break
			case 'series':
				if (movie.series && movie.series[seasonKey]) {
					if (cannotBeDeleted(req, movie.series[seasonKey][episodeKey])) {
						return notEnoughRights()
					}

					if (episodeKey < movie.series[seasonKey].length) {
						updateOptions.$set = { [`series.${seasonKey}.${episodeKey}`]: videoParams }
						break
					}
				}

				updateOptions.$push = { [`series.${seasonKey}`]: videoParams }
		}

		// Обновление ссылки на файл в БД
		await Movie.updateOne({ _id: movieId }, updateOptions)

		return resSuccess({
			res,
			movieId,
			...videoParams,
		})
	} catch (err) {
		return resError({ res, msg: err })
	}
})

/*
 * Обновление прогресса загрузки видеофрагментов
 */
router.post('/uploadingUpdate', verify.token, verify.isManager, async (req, res) => {
	let { movieId, name, seasonKey, episodeKey } = req.body

	try {
		const movie = await Movie.findOne({ _id: movieId })
		if (
			(name === 'series' && movie.categoryAlias != 'serials') ||
			(name === 'films' && movie.categoryAlias != 'films')
		) {
			return resError({
				res,
				alert: true,
				msg: 'Категория страницы была изменена',
			})
		}

		let needToUpdate = false
		const $set = {}

		// Добавить поле для обновления даты
		const setUpdate = (path) => {
			$set[`${path}.lastUpdateAt`] = Date.now()
			needToUpdate = true
		}

		switch (name) {
			case 'trailer':
				if (movie.trailer) {
					setUpdate('trailer')
				}
				break
			case 'films':
				if (movie.films && movie.films[0]) {
					setUpdate('films.0')
				}
				break
			case 'series':
				if (movie.series && movie.series[seasonKey] && movie.series[seasonKey][episodeKey]) {
					setUpdate(`series.${seasonKey}.${episodeKey}`)
				}
		}

		// Обновить загрузку видео
		if (needToUpdate) {
			await Movie.updateOne({ _id: movieId }, { $set })
		}

		return res.status(200).json()
	} catch (err) {
		return resError({ res, msg: err })
	}
})

/*
 * Удаление изображений
 */
router.delete('/image', verify.token, verify.isManager, async (req, res) => {
	const { movieId, name } = req.body

	try {
		// Удаление ссылки на файл в БД
		const movie = await Movie.findOneAndUpdate({ _id: movieId }, { $unset: { [name]: {} } })

		// Удаление старого файла
		const pathToOldFile = movie[name].src
		if (pathToOldFile) await deleteFileFromS3(pathToOldFile)

		return resSuccess({
			res,
			alert: true,
			msg: 'Успешно удалено',
		})
	} catch (err) {
		return resError({ res, msg: err })
	}
})

/*
 * Удаление видео
 */
router.delete('/video', verify.token, verify.isManager, async (req, res) => {
	const { movieId, name, seasonKey, episodeKey } = req.body

	try {
		const movie = await Movie.findOne({ _id: movieId })
		if (
			(name === 'series' && movie.categoryAlias != 'serials') ||
			(name === 'films' && movie.categoryAlias != 'films')
		) {
			return resError({
				res,
				alert: true,
				msg: 'Категория страницы была изменена',
			})
		}

		let updateOptions

		const notEnoughRights = () =>
			resError({
				res,
				alert: true,
				msg: 'Недостаточно прав',
			})

		switch (name) {
			case 'trailer':
				if (!movie.trailer) break

				if (cannotBeDeleted(req, movie.trailer)) {
					return notEnoughRights()
				}

				updateOptions = { $unset: { trailer: {} } }
				break
			case 'films':
				if (!movie.films || !movie.films[0]) break

				const film = movie.films[0]

				if (cannotBeDeleted(req, film)) {
					return notEnoughRights()
				}

				updateOptions = { $pull: { films: { _id: film._id } } }
				break
			case 'series':
				if (!movie.series || !movie.series[seasonKey] || !movie.series[seasonKey][episodeKey]) {
					break
				}

				const episode = movie.series[seasonKey][episodeKey]

				if (cannotBeDeleted(req, episode)) {
					return notEnoughRights()
				}

				updateOptions = { $pull: { [`series.${seasonKey}`]: { _id: episode._id } } }
		}

		// Удалить видео из БД
		if (updateOptions) {
			await Movie.updateOne({ _id: movieId }, updateOptions)

			// Удаление пустых массивов
			if (name == 'series') {
				await Movie.updateOne(
					{ _id: movieId },
					{ $pull: { series: { $in: [[]] } } },
					{ multi: true }
				)
			}
		}

		return resSuccess({
			res,
			alert: true,
			msg: 'Успешно удалено',
		})
	} catch (err) {
		return resError({ res, msg: err })
	}
})

/*
 * Задать/изменить планируемую дату публикации
 */
router.post('/willPublish', verify.token, verify.isManager, existMovie, async (req, res) => {
	const {
		movieId,
		willPublishedAt, //YYYY-MM-DD HH:mm
	} = req.body

	try {
		let movie = await Movie.findOne({ _id: movieId })

		if (!movie) {
			return resError({
				res,
				alert: true,
				msg: 'Страница была удалена',
			})
		}

		if (movie.publishedAt) {
			return resError({
				res,
				alert: true,
				msg: 'Страница уже была опубликована',
			})
		}

		if (!movie.name) {
			return resError({
				res,
				alert: true,
				msg: 'Необходимо название',
			})
		}

		if (!movie.alias) {
			return resError({
				res,
				alert: true,
				msg: 'Необходим ЧПУ-адрес',
			})
		}

		if (!movie.categoryAlias) {
			return resError({
				res,
				alert: true,
				msg: 'Необходима категория',
			})
		}

		if (!movie.genresAliases || !movie.genresAliases.length) {
			return resError({
				res,
				alert: true,
				msg: 'Необходимы жанры',
			})
		}

		if (new Date(willPublishedAt) < new Date()) {
			return resError({
				res,
				alert: true,
				msg: 'Нельзя задать планируемую дату публикации на уже прошедшую дату',
			})
		}

		await Movie.updateOne({ _id: movieId }, { willPublishedAt })

		schedule.scheduleJob(new Date(willPublishedAt), async function () {
			const set = {
				publishedAt: new Date(),
				willPublishedAt: null,
			}

			await Movie.updateOne({ _id: movieId }, { $set: set })
		})

		return resSuccess({
			res,
			movieId,
			willPublishedAt,
		})
	} catch (err) {
		return resError({ res, msg: err })
	}
})

/*
 * Удалить страницу и все ее медиа материалы
 */
router.delete('/', verify.token, verify.isManager, async (req, res) => {
	const { _id } = req.body

	try {
		const movie = await Movie.findOne({ _id })

		const { logo, films, cover, series, poster, trailer } = movie

		// Удаление логотипа
		if (logo && logo.src) await deleteFileFromS3(logo.src)
		// Удаление обложки
		if (cover && cover.src) await deleteFileFromS3(cover.src)
		// Удаление постера
		if (poster && poster.src) await deleteFileFromS3(poster.src)

		// Удаление трейлера
		if (trailer) deleteVideoExecute(trailer)

		// Удаление всех фильмов
		if (films) films.forEach(deleteVideoExecute)

		// Удаление всех серий
		if (series) series.forEach((season) => season.forEach(deleteVideoExecute))

		// Удаление записи из БД
		await Movie.deleteOne({ _id })

		return resSuccess({
			res,
			_id,
			alert: true,
			msg: 'Успешно удалено',
		})
	} catch (err) {
		return resError({ res, msg: err })
	}
})

// Вызвать функцию очистки файлов при каждой перезагрузке API
CleanupLog.find((err, data) => {
	data.forEach((item) => deleteVideoExecute(item, false))
})

module.exports = router
