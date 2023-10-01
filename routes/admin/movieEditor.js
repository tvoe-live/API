const { S3_UPLOAD_KEY, S3_UPLOAD_SECRET, S3_UPLOAD_REGION, S3_UPLOAD_BUCKET, S3_UPLOAD_ENDPOINT } =
	process.env
const express = require('express')
const router = express.Router()
const multer = require('multer')
const mongoose = require('mongoose')
const Movie = require('../../models/movie')
const verify = require('../../middlewares/verify')
const resError = require('../../helpers/resError')
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

	req.query.movieId = newMovie._id

	next()
}

// Удаление видео
const deleteVideoExecute = async (video) => {
	if (video.src) {
		await deleteFolderFromS3(video.src)
	}
	if (video.thumbnail) {
		await deleteFileFromS3(video.thumbnail)
	}

	// Через 5 минут повторить ещё раз, чтобы наверняка
	setTimeout(deleteVideoExecute, 300000, video)
}

// Проверка на существование фильма и его индекс
const findFilm = (movie, _id) => {
	return movie.films.findIndex((film) => film._id.toString() === _id)
}

// Проверка на существование серии и возвращение пути к ней
const findSeasonAndEpisode = (movie, _id) => {
	let episodeKey
	const seasonKey = movie.series.findIndex((season) => {
		episodeKey = season.findIndex((episode) => episode._id.toString() === _id)
		return episodeKey != -1
	})
	return [seasonKey, episodeKey]
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
	existMovie,
	uploadMemoryStorage.single('file'),
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

		// Если нельзя удалить видео, то выдать ошибку
		const cannotBeDeleted = (video) => {
			if (!video || !video.status) return false

			if (video.status === 'READY' || req.user._id === video.managerUserId) {
				deleteVideoExecute(video)
				return false
			}

			return true
		}

		const updateOptions = {}

		switch (name) {
			case 'trailer':
				if (cannotBeDeleted(movie.trailer)) {
					return resError({
						res,
						alert: true,
						msg: 'Трейлер уже загружается',
					})
				}

				updateOptions.$set = { trailer: videoParams }
				break
			case 'films':
				if (movie.films && cannotBeDeleted(movie.films[0])) {
					return resError({
						res,
						alert: true,
						msg: 'Фильм уже загружается',
					})
				}

				updateOptions.$push = { films: videoParams }
				break
			case 'series':
				if (movie.series && movie.series[seasonKey]) {
					if (cannotBeDeleted(movie.series[seasonKey][episodeKey])) {
						return resError({
							res,
							alert: true,
							msg: 'Серия уже загружается',
						})
					}

					if (episodeKey !== movie.series[seasonKey].length - 1) {
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

router.post('/uploadingUpdate', verify.token, verify.isManager, async (req, res) => {
	let { movieId, uploadingIds } = req.body

	if (typeof uploadingIds === 'string') {
		uploadingIds = JSON.parse(uploadingIds)
	}

	try {
		const movie = await Movie.findOne({ _id: movieId })

		let needToUpdate = false
		const $set = {}

		// Добавить поле для обновления даты
		const setUpdate = (path) => {
			$set[`${path}.lastUpdateAt`] = Date.now()
			needToUpdate = true
		}

		if (movie.trailer) {
			const trailerId = movie.trailer._id.toString()

			if (uploadingIds.indexOf(trailerId) != -1) {
				setUpdate('trailer')
			}
		}

		if (Array.isArray(movie.films)) {
			movie.films.forEach((film, filmKey) => {
				const filmId = film._id.toString()

				if (uploadingIds.indexOf(filmId) != -1) {
					setUpdate(`films.${filmKey}`)
				}
			})
		}

		if (Array.isArray(movie.series)) {
			movie.series.forEach((season, seasonKey) => {
				season.forEach((episode, episodeKey) => {
					const episodeId = episode._id.toString()

					if (uploadingIds.indexOf(episodeId) != -1) {
						setUpdate(`series.${seasonKey}.${episodeKey}`)
					}
				})
			})
		}

		if (needToUpdate) {
			await Movie.updateOne({ _id: movieId }, { $set })
		}

		return res.status(200).json()
	} catch (err) {
		return resError({ res, msg: err })
	}
})

/*
 * Обновление прогресса загрузки видеофрагментов
 */
router.post('/video/progress', verify.token, verify.isManager, async (req, res) => {
	const { _id, name, movieId } = req.body

	try {
		let movie = await Movie.findOne({ _id: movieId })
		if (!movie) {
			return resError({
				res,
				alert: true,
				msg: 'Страница была удалена',
			})
		} else if (
			(name == 'series' && movie.categoryAlias != 'serials') ||
			(name == 'films' && movie.categoryAlias != 'films')
		) {
			return resError({
				res,
				alert: true,
				msg: 'Категория страницы была изменена',
			})
		}

		let firstSet

		switch (name) {
			case 'trailer':
				if (movie[name] && movie[name].status == 'uploading') {
					firstSet = { $inc: { 'trailer.uploaded': 1 } }
				}
				break
			case 'films':
				const filmKey = findFilm(movie, _id)
				if (filmKey != -1 && movie[name][filmKey].status == 'uploading') {
					firstSet = { $inc: { [`films.${filmKey}.uploaded`]: 1 } }
				}
				break
			case 'series':
				const [seasonKey, episodeKey] = findSeasonAndEpisode(movie, _id)
				if (
					seasonKey != -1 &&
					episodeKey != -1 &&
					movie[name][seasonKey][episodeKey].status == 'uploading'
				) {
					firstSet = { $inc: { [`series.${seasonKey}.${episodeKey}.uploaded`]: 1 } }
				}
				break
			default:
				break
		}

		if (firstSet) {
			// Увеличить количество загруженных файлов на 1
			movie = await Movie.findOneAndUpdate({ _id: movieId }, firstSet)

			let secondSet

			// Перепроверка изменений
			switch (name) {
				case 'trailer':
					const trailer = movie[name]
					if (!trailer || trailer.status != 'uploading') break
					if (trailer.uploaded + 1 >= trailer.total) {
						secondSet = {
							$set: { 'trailer.status': 'ready' },
							$min: { 'trailer.uploaded': trailer.total },
						}
					} else {
						setTimeout(async () => {
							const recheckedMovie = await Movie.findOne({ _id: movieId })
							if (!recheckedMovie) return

							const recheckedTrailer = recheckedMovie[name]
							if (!recheckedTrailer || recheckedTrailer.status != 'uploading') return

							// Процесс удаления видео
							if (trailer.uploaded + 1 == recheckedTrailer.uploaded) {
								await Movie.updateOne({ _id: movieId }, { $set: { 'trailer.status': 'removing' } })
								await deleteFolderFromS3(recheckedTrailer.src)
								await deleteFileFromS3(recheckedTrailer.thumbnail)
								await Movie.updateOne({ _id: movieId }, { $unset: { trailer: {} } })
							}
						}, 300000)
					}
					break
				case 'films':
					const filmKey = findFilm(movie, _id)
					if (filmKey == -1) break

					const film = movie[name][filmKey]
					if (film.status != 'uploading') break
					if (film.uploaded + 1 >= film.total) {
						secondSet = {
							$set: { [`films.${filmKey}.status`]: 'ready' },
							$min: { [`films.${filmKey}.uploaded`]: film.total },
						}
					} else {
						setTimeout(async () => {
							const recheckedMovie = await Movie.findOne({ _id: movieId })
							if (!recheckedMovie) return

							const recheckedFilmKey = findFilm(recheckedMovie, _id)
							if (recheckedFilmKey == -1) return

							const recheckedFilm = recheckedMovie[name][recheckedFilmKey]
							if (recheckedFilm.status != 'uploading') return

							// Процесс удаления видео
							if (film.uploaded + 1 == recheckedFilm.uploaded) {
								await Movie.updateOne(
									{ _id: movieId },
									{ $set: { [`films.${recheckedFilmKey}.status`]: 'removing' } }
								)
								await deleteFolderFromS3(recheckedFilm.src)
								await deleteFileFromS3(recheckedFilm.thumbnail)
								await Movie.updateOne(
									{ _id: movieId },
									{ $pull: { films: { _id: mongoose.Types.ObjectId(_id) } } }
								)
							}
						}, 300000)
					}
					break
				case 'series':
					const [seasonKey, episodeKey] = findSeasonAndEpisode(movie, _id)
					if (seasonKey == -1 || episodeKey == -1) break

					const episode = movie[name][seasonKey][episodeKey]
					if (episode.status != 'uploading') break
					if (episode.uploaded + 1 >= episode.total) {
						secondSet = {
							$set: { [`series.${seasonKey}.${episodeKey}.status`]: 'ready' },
							$min: { [`series.${seasonKey}.${episodeKey}.uploaded`]: episode.total },
						}
					} else {
						setTimeout(async () => {
							const recheckedMovie = await Movie.findOne({ _id: movieId })
							if (!recheckedMovie) return

							const [recheckedSeasonKey, recheckedEpisodeKey] = findSeasonAndEpisode(
								recheckedMovie,
								_id
							)
							if (recheckedSeasonKey == -1 || recheckedEpisodeKey == -1) return

							const recheckedEpisode = recheckedMovie[name][recheckedSeasonKey][recheckedEpisodeKey]
							if (recheckedEpisode.status != 'uploading') return

							// Процесс удаления видео
							if (episode.uploaded + 1 == recheckedEpisode.uploaded) {
								await Movie.updateOne(
									{ _id: movieId },
									{
										$set: {
											[`series.${recheckedSeasonKey}.${recheckedEpisodeKey}.status`]: 'removing',
										},
									}
								)
								await deleteFolderFromS3(recheckedEpisode.src)
								await deleteFileFromS3(recheckedEpisode.thumbnail)
								await Movie.updateOne(
									{ _id: movieId },
									{
										$pull: {
											[`series.${seasonKey}`]: {
												_id: mongoose.Types.ObjectId(_id),
											},
										},
									}
								)
								await Movie.updateOne(
									{ _id: movieId },
									{
										$pull: {
											series: { $in: [[]] },
										},
									},
									{ multi: true }
								)
							}
						}, 300000)
					}
					break
				default:
					break
			}

			// Изменить статус видео, если оно загружено до конца
			if (secondSet) await Movie.updateOne({ _id: movieId }, secondSet)
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
	const { _id, name, movieId } = req.body

	try {
		const movie = await Movie.findOne({ _id: movieId })
		if (!movie) {
			return resError({
				res,
				alert: true,
				msg: 'Страница была удалена',
			})
		} else if (
			(name == 'series' && movie.categoryAlias != 'serials') ||
			(name == 'films' && movie.categoryAlias != 'films')
		) {
			return resError({
				res,
				alert: true,
				msg: 'Категория страницы была изменена',
			})
		}

		let updateSet, deleteSet

		// Пути видео и миниатюры для удаления
		let pathToOldVideoSrc
		let pathToOldThumbnail

		switch (name) {
			case 'trailer':
				if (!movie[name]) break

				switch (movie[name].status) {
					case 'removing':
						return resError({
							res,
							alert: true,
							msg: 'Трейлер уже удаляется',
						})
					case 'uploading':
						return resError({
							res,
							alert: true,
							msg: 'Трейлер уже загружается',
						})
					case 'ready':
						updateSet = { $set: { 'trailer.status': 'removing' } }
						deleteSet = { $unset: { trailer: {} } }

						pathToOldVideoSrc = movie[name].src
						pathToOldThumbnail = movie[name].thumbnail
						break
					default:
						deleteSet = { $unset: { trailer: {} } }
				}
				break
			case 'films':
				const filmKey = findFilm(movie, _id)
				if (filmKey == -1) break

				switch (movie[name][filmKey].status) {
					case 'removing':
						return resError({
							res,
							alert: true,
							msg: 'Фильм уже удаляется',
						})
					case 'uploading':
						return resError({
							res,
							alert: true,
							msg: 'Фильм уже загружается',
						})
					case 'ready':
						updateSet = { $set: { [`films.${filmKey}.status`]: 'removing' } }
						deleteSet = { $pull: { films: { _id: mongoose.Types.ObjectId(_id) } } }

						pathToOldVideoSrc = movie[name][filmKey].src
						pathToOldThumbnail = movie[name][filmKey].thumbnail
						break
					default:
						deleteSet = { $pull: { films: { _id: mongoose.Types.ObjectId(_id) } } }
				}
				break
			case 'series':
				const [seasonKey, episodeKey] = findSeasonAndEpisode(movie, _id)
				if (seasonKey == -1 || episodeKey == -1) break

				switch (movie[name][seasonKey][episodeKey].status) {
					case 'removing':
						return resError({
							res,
							alert: true,
							msg: 'Эта серия уже удаляется',
						})
					case 'uploading':
						return resError({
							res,
							alert: true,
							msg: 'Эта серия уже загружается',
						})
					case 'ready':
						updateSet = {
							$set: { [`series.${seasonKey}.${episodeKey}.status`]: 'removing' },
						}
						deleteSet = {
							$pull: {
								[`series.${seasonKey}`]: { _id: mongoose.Types.ObjectId(_id) },
							},
						}

						pathToOldVideoSrc = movie[name][seasonKey][episodeKey].src
						pathToOldThumbnail = movie[name][seasonKey][episodeKey].thumbnail
						break
					default:
						deleteSet = {
							$pull: {
								[`series.${seasonKey}`]: { _id: mongoose.Types.ObjectId(_id) },
							},
						}
				}
				break
			default:
				break
		}

		// Обновить статус видео
		if (updateSet) await Movie.updateOne({ _id: movieId }, updateSet)

		// Удаление старых файлов
		if (pathToOldVideoSrc) await deleteFolderFromS3(pathToOldVideoSrc)
		if (pathToOldThumbnail) await deleteFileFromS3(pathToOldThumbnail)

		// Удаление ссылки на фаил в БД
		if (deleteSet) {
			await Movie.updateOne({ _id: movieId }, deleteSet)

			// Удаление пустых массивов
			if (name == 'series') {
				await Movie.updateOne(
					{ _id: movieId },
					{
						$pull: {
							series: { $in: [[]] },
						},
					},
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
 * Удалить видео, которые не догрузились, если менеджер перезагрузил или закрыл страницу
 */
router.post('/unload', verify.token, verify.isManager, async (req, res) => {
	const { movieId, uploadingProcesses } = req.body

	try {
		const movie = await Movie.findOne({ _id: movieId })
		const removingPromises = []

		let updateSet,
			seriesFound = false

		for (const { _id, name } of uploadingProcesses) {
			let deleteSet

			// Пути видео и миниатюры для удаления
			let pathToOldVideoSrc
			let pathToOldThumbnail

			switch (name) {
				case 'trailer':
					if (movie[name].status == 'uploading') {
						if (!updateSet) updateSet = {}
						if (!updateSet.$set) updateSet.$set = {}
						updateSet.$set['trailer.status'] = 'removing'
						deleteSet = { $unset: { trailer: {} } }

						pathToOldVideoSrc = movie[name].src
						pathToOldThumbnail = movie[name].thumbnail
					}
					break
				case 'films':
					const filmKey = findFilm(movie, _id)
					if (filmKey != -1 && movie[name][filmKey].status == 'uploading') {
						if (!updateSet) updateSet = {}
						if (!updateSet.$set) updateSet.$set = {}
						updateSet.$set[`films.${filmKey}.status`] = 'removing'
						deleteSet = { $pull: { films: { _id: mongoose.Types.ObjectId(_id) } } }

						pathToOldVideoSrc = movie[name][filmKey].src
						pathToOldThumbnail = movie[name][filmKey].thumbnail
					}
					break
				case 'series':
					const [seasonKey, episodeKey] = findSeasonAndEpisode(movie, _id)
					if (
						seasonKey != -1 &&
						episodeKey != -1 &&
						movie[name][seasonKey][episodeKey].status == 'uploading'
					) {
						if (!updateSet) updateSet = {}
						if (!updateSet.$set) updateSet.$set = {}
						updateSet.$set[`series.${seasonKey}.${episodeKey}.status`] = 'removing'
						deleteSet = {
							$pull: {
								[`series.${seasonKey}`]: { _id: mongoose.Types.ObjectId(_id) },
							},
						}

						pathToOldVideoSrc = movie[name][seasonKey][episodeKey].src
						pathToOldThumbnail = movie[name][seasonKey][episodeKey].thumbnail
						seriesFound = true
					}
					break
				default:
					break
			}
			if (deleteSet) {
				removingPromises.push(
					new Promise(async (resolve) => {
						// Удаление старых файлов
						if (pathToOldVideoSrc) await deleteFolderFromS3(pathToOldVideoSrc)
						if (pathToOldThumbnail) await deleteFileFromS3(pathToOldThumbnail)

						// Удаление ссылки на фаил в БД
						await Movie.updateOne({ _id: movieId }, deleteSet)
						resolve()
					})
				)
			}
		}

		// Обновить статус видео
		if (updateSet) await Movie.updateOne({ _id: movieId }, updateSet)

		// Удаление всех недогруженных фрагментов
		if (removingPromises.length) await Promise.allSettled(removingPromises)

		// Удаление пустых массивов
		if (seriesFound) {
			await Movie.updateOne(
				{ _id: movieId },
				{
					$pull: {
						series: { $in: [[]] },
					},
				},
				{ multi: true }
			)
		}

		return res.status(200).json()
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

		if (trailer) {
			// Удаление трейлера
			if (trailer.src) await deleteFolderFromS3(trailer.src)
			// Удаление превью трейлера
			if (trailer.thumbnail) await deleteFileFromS3(trailer.thumbnail)
		}

		if (films) {
			films.map(async (film) => {
				// Удаление всех фильмов
				if (film.src) await deleteFolderFromS3(film.src)
				// Удаление всех превью фильмов
				if (film.thumbnail) await deleteFileFromS3(film.thumbnail)
			})
		}

		if (series) {
			series.map((season) => {
				season.map(async (series) => {
					// Удаление всех серий
					if (series.src) await deleteFolderFromS3(series.src)
					// Удаление всех превью серий
					if (series.thumbnail) await deleteFileFromS3(series.thumbnail)
				})
			})
		}

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

module.exports = router
