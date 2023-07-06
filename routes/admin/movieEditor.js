const {
	S3_UPLOAD_KEY,
	S3_UPLOAD_SECRET,
	S3_UPLOAD_REGION,
	S3_UPLOAD_BUCKET,
	S3_UPLOAD_ENDPOINT
} = process.env;
const express = require('express');
const router = express.Router();
const multer = require('multer');
const mongoose = require('mongoose');
const Movie = require('../../models/movie');
const verify = require('../../middlewares/verify');
const resError = require('../../helpers/resError');
const resSuccess = require('../../helpers/resSuccess');
const { uploadImageToS3 } = require('../../helpers/uploadImage');
const { deleteFileFromS3, deleteFolderFromS3 } = require('../../helpers/deleteFile');

/*
 * Админ-панель > Редактор медиа страницы
 */

// Получение уникального ID от базы данных
const getObjectId = () => new mongoose.Types.ObjectId();

// Загрузка картинок в буффер
const memoryStorage = multer.memoryStorage();
const uploadMemoryStorage = multer({ storage: memoryStorage });

/*
 * Создание медиа страницы, если ее не существует
 */
const existMovie = async (req, res, next) => {
	const { movieId } = req.body;

	if(movieId) return next()

	const newMovie = await Movie.create({
		raisedUpAt: new Date(),
		creatorUserId: req.user._id
	})

	req.query.movieId = newMovie._id

	next()
}

// Проверка на существование серии и возвращение путя к ней
const findSeasonAndEpisode = (movie) => {
	let seriesIndex;
	const seasonIndex = movie.series.findIndex(season => {
		seriesIndex = season.findIndex(series => series._id.toString() === _id);
		return seriesIndex != -1;
	});
	return [seasonIndex, seriesIndex];
};

/*
 * Получить данные для клиента S3 
 */
router.get('/s3data', verify.token, verify.isManager, async (req, res) => {
	return res.status(200).json({
		S3_UPLOAD_KEY,
		S3_UPLOAD_SECRET,
		S3_UPLOAD_REGION,
		S3_UPLOAD_BUCKET,
		S3_UPLOAD_ENDPOINT
	});
});

/*
 * Загрузка обложки, постера или логотипа
 */
router.post('/image', verify.token, verify.isManager, existMovie, uploadMemoryStorage.single('file'), async (req, res) => {
	const { buffer } = req.file;
	const { name, movieId } = req.body;

	const { fileId, fileSrc } = await uploadImageToS3({
		res,
		buffer,
		type: name === 'logo' ? 'png' : 'jpg'
	})

	// Добавление / обновление ссылки на фаил в БД
	const movie = await Movie.findOneAndUpdate(
		{ _id: movieId }, 
		{ $set: {
			[name]: {
				_id: fileId,
				src: fileSrc
			}
		} }
	);

	const pathToOldFile = movie[name].src
	// Удаление старого файла
	if(pathToOldFile) await deleteFileFromS3(pathToOldFile)

	return resSuccess({
		res,
		movieId,
		alert: true,
		_id: fileId,
		src: fileSrc,
		msg: 'Успешно сохранено'
	})
});

/*
 * Загрузка видео и миниатюры
 */
router.post('/video', verify.token, verify.isManager, existMovie, async (req, res) => {
	const {
		_id,
		name,
		movieId,
		duration,
		qualities,
		audio,
		subtitles,
		files,
		total,
		seasonKey,
		episodeKey
	} = req.body;

	let set;

	try {
		let movie = await Movie.findOne({ _id: movieId });
		if(!movie) {
			return resError({
				res,
				alert: true,
				msg: 'Эта страница была удалена'
			});
		}

		const videoParams = {
			_id: getObjectId(),
			src: `/videos/${getObjectId()}`,
			thumbnail: `/images/${getObjectId()}.jpg`,
			duration,
			qualities,
			audio,
			subtitles,
			files,
			status: 'uploading',
			uploaded: 0,
			total
		};

		switch(name) {
			case 'trailer':
				if(movie.trailer && movie.trailer.status) {
					let msg;
					switch(movie.trailer.status) {
						case 'uploading':
							msg = 'Кто-то уже загружает трейлер';
							break;
						case 'removing':
							msg = 'Кто-то уже удаляет трейлер';
							break;
						case 'ready':
							msg = 'Кто-то уже добавил трейлер';
							break;
						default: break;
					}
					return resError({ res, alert: true, msg });
				}
				set = { $set: { trailer: videoParams } };
				break;
			case 'films':
				if(movie.films && movie.films[0]) {
					let msg;
					switch(movie[name][0].status) {
						case 'uploading':
							msg = 'Кто-то уже загружает фильм';
							break;
						case 'removing':
							msg = 'Кто-то уже удаляет фильм';
							break;
						case 'ready':
							msg = 'Кто-то уже добавил фильм';
							break;
						default: break;
					}
					return resError({ res, alert: true, msg });
				}
				set = { $addToSet: { films: videoParams } };
				break;
			case 'series':
				const previousSeason = movie.series[seasonKey - 1];

				if(typeof seasonKey === undefined || seasonKey < 0) {
					return resError({
						res, 
						alert: true,
						msg: 'Указан неверный ключ сезона'
					});
				}

				if(typeof episodeKey === undefined || episodeKey < 0) {
					return resError({
						res, 
						alert: true,
						msg: 'Указан неверный ключ серии'
					});
				}

				if(!previousSeason && seasonKey > 0) {
					return resError({
						res, 
						alert: true,
						msg: 'Необходимо создать предыдущий сезон'
					});
				}

				// Добавить новую серию в конец
				const pushSeries = () => {
					set = { $push: { [`series.${seasonKey}`]: videoParams } };
				};

				let [seasonIndex, seriesIndex] = findSeasonAndEpisode(movie);
				if(seasonIndex == -1 || seriesIndex == -1) {
					pushSeries();
				} else {
					switch(movie[name][seasonIndex][seriesIndex].status) {
						case 'uploading':
							return resError({
								res, 
								alert: true,
								msg: 'Кто-то уже загружает эту серию'
							});
						case 'removing':
							return resError({
								res, 
								alert: true,
								msg: 'Кто-то уже удаляет эту серию'
							});
						case 'ready':
							const pathToOldVideoSrc = movie[name][seasonIndex][seriesIndex].src;
							const pathToOldThumbnail = movie[name][seasonIndex][seriesIndex].thumbnail;

							// Обновить статус видео
							await Movie.updateOne(
								{ _id: movieId },
								{ $set: { [`series.${seasonIndex}.${seriesIndex}.status`]: 'removing' } }
							);

							// Удаление старых файлов
							if(pathToOldVideoSrc) await deleteFolderFromS3(pathToOldVideoSrc);
							if(pathToOldThumbnail) await deleteFileFromS3(pathToOldThumbnail);

							// Снова найти информацию о фильме (его могли удалить или порядок серий мог поменяться)
							movie = await Movie.findOne({ _id: movieId });
							if(!movie) {
								return resError({
									res,
									alert: true,
									msg: 'Эта страница была удалена'
								});
							}

							[seasonIndex, seriesIndex] = findSeasonAndEpisode(movie);
							if(seasonIndex == -1 || seriesIndex == -1) {
								pushSeries();
							} else {
								// Заменить старую серию
								set = { $set: { [`series.${seasonIndex}.${seriesIndex}`]: videoParams } };
							}
							break;
						default: break;
					}
				}

				// Добавить поля для серий, если их нет
				if(!movie.series || !movie.series.length) {
					await Movie.updateOne({ _id: movieId }, { $set: { series: [] } });
				}
				break;
			default: break
		}

		// Добавление / обновление ссылки на фаил в БД
		await Movie.updateOne({ _id: movieId }, set);

		return resSuccess({
			res,
			movieId,
			...videoParams
		});
	} catch(err) {
		return resError({ res, msg: err });
	}
});

/*
 * Удаление изображений
 */
router.delete('/image', verify.token, verify.isManager, async (req, res) => {
	const { name, movieId } = req.body;

	try {
		// Удаление ссылки на фаил в БД
		const movie = await Movie.findOneAndUpdate(
			{ _id: movieId }, 
			{ $unset: { [name]: {} } }
		);

		const pathToOldFile = movie[name].src
		// Удаление старого файла
		if(pathToOldFile) await deleteFileFromS3(pathToOldFile)

		return resSuccess({
			res,
			alert: true,
			msg: 'Успешно удалено'
		})
	} catch(err) {
		return resError({ res, msg: err });
	}
});

/*
 * Удаление видео
 */
router.delete('/video', verify.token, verify.isManager, async (req, res) => {
	const { 
		_id,
		name,
		movieId,
		seasonKey,
		interrupted
	} = req.body;

	const videoParams = {
		status: 'removing'
	};

	let updateSet, deleteSet;

	try {
		const movie = await Movie.findOne({ _id: movieId });
		if(!movie) {
			return resError({
				res,
				alert: true,
				msg: 'Эта страница была удалена'
			});
		}

		// Пути видео и миниатюры для удаления
		let pathToOldVideoSrc;
		let pathToOldThumbnail;

		switch(name) {
			case 'trailer':
				if(movie.trailer) {
					switch(movie.trailer.status) {
						case 'removing':
							return resError({
								res, 
								alert: true,
								msg: 'Кто-то уже удаляет трейлер'
							});
						case 'uploading':
							if (!interrupted) {
								return resError({
									res, 
									alert: true,
									msg: 'Кто-то уже загружает трейлер'
								});
							}
						case 'ready':
							updateSet = { $set: { trailer: videoParams } };
							deleteSet = { $unset: { trailer: {} } };

							pathToOldVideoSrc = movie[name].src;
							pathToOldThumbnail = movie[name].thumbnail;
							break;
						default: break;
					}
				}
				break;
			case 'films':
				const filmIndex = movie[name].findIndex(film => film._id.toString() === _id);
				if(filmIndex != -1) {
					switch(movie[name][filmIndex].status) {
						case 'removing':
							return resError({
								res, 
								alert: true,
								msg: 'Кто-то уже удаляет фильм'
							});
						case 'uploading':
							if (!interrupted) {
								return resError({
									res, 
									alert: true,
									msg: 'Кто-то уже загружает фильм'
								});
							}
						case 'ready':
							updateSet = { $set: { [`films.${filmIndex}`]: videoParams } };
							deleteSet = { $pull: { films: { _id } } };
		
							pathToOldVideoSrc = movie[name][filmIndex].src;
							pathToOldThumbnail = movie[name][filmIndex].thumbnail;
							break;
						default: break;
					}
				}
				break;
			case 'series':
				const [seasonIndex, seriesIndex] = findSeasonAndEpisode(movie);
				if(seasonIndex != -1 || seriesIndex != -1) {
					switch(movie[name][seasonIndex][seriesIndex].status) {
						case 'removing':
							return resError({
								res, 
								alert: true,
								msg: 'Кто-то уже удаляет эту серию'
							});
						case 'uploading':
							if (!interrupted) {
								return resError({
									res, 
									alert: true,
									msg: 'Кто-то уже загружает эту серию'
								});
							}
						case 'ready':
							updateSet = { $set: { [`series.${seasonIndex}.${seriesIndex}`]: videoParams } };
							deleteSet = { $pull: { [`series.${seasonIndex}`]: { _id } } };

							pathToOldVideoSrc = movie[name][seasonIndex][seriesIndex].src;
							pathToOldThumbnail = movie[name][seasonIndex][seriesIndex].thumbnail;
							break;
						default: break;
					}
				}
				break;
			default: break;
		}

		// Обновить статус видео
		if(updateSet) await Movie.findOneAndUpdate({ _id: movieId }, updateSet);

		// Удаление старых файлов
		if(pathToOldVideoSrc) await deleteFolderFromS3(pathToOldVideoSrc);
		if(pathToOldThumbnail) await deleteFileFromS3(pathToOldThumbnail);

		// Удаление ссылки на фаил в БД
		if(deleteSet) {
			await Movie.updateOne({ _id: movieId }, deleteSet);

			// Удаление пустых массивов
			if(name == 'series') {
				await Movie.updateOne(
					{ _id: movieId }, 
					{ $pull: {
						series: { $in:[[]] }
					} },
					{ multi: true }
				);
			}
		}

		return resSuccess({
			res,
			alert: true,
			msg: 'Успешно удалено'
		});
	} catch(err) {
		return resError({ res, msg: err });
	}
});

/*
 * Удалить страницу и все ее медиа материалы
 */
router.delete('/', verify.token, verify.isManager, async (req, res) => {
	const { _id } = req.body;

	try {
		const movie = await Movie.findOne({ _id });

		const {
			logo,
			films,
			cover,
			series,
			poster,
			trailer
		} = movie;

		// Удаление логотипа
		if(logo && logo.src) await deleteFileFromS3(logo.src);
		// Удаление обложки
		if(cover && cover.src) await deleteFileFromS3(cover.src);
		// Удаление постера
		if(poster && poster.src) await deleteFileFromS3(poster.src);
		
		if(trailer) {
			// Удаление трейлера
			if(trailer.src) await deleteFolderFromS3(trailer.src);
			// Удаление превью трейлера
			if(trailer.thumbnail) await deleteFileFromS3(trailer.thumbnail);
		}

		if(films) {
			films.map(async film => {
				// Удаление всех фильмов
				if(film.src) await deleteFolderFromS3(film.src);
				// Удаление всех превью фильмов
				if(film.thumbnail) await deleteFileFromS3(film.thumbnail);
			});
		}

		if(series) {
			series.map(season => {
				season.map(async series => {
					// Удаление всех серий
					if(series.src) await deleteFolderFromS3(series.src);
					// Удаление всех превью серий
					if(series.thumbnail) await deleteFileFromS3(series.thumbnail);
				});
			});
		}

		// Удаление записи из БД
		await Movie.deleteOne({ _id });

		return resSuccess({
			res,
			_id,
			alert: true,
			msg: 'Успешно удалено'
		})
	} catch(err) {
		return resError({ res, msg: err });
	}
});

module.exports = router;