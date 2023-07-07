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

// Проверка на существование фильма и его индекс
const findFilm = (movie, _id) => {
	return movie.films.findIndex(film => film._id.toString() === _id);
};

// Проверка на существование серии и возвращение пути к ней
const findSeasonAndEpisode = (movie, _id) => {
	let episodeKey;
	const seasonKey = movie.series.findIndex(season => {
		episodeKey = season.findIndex(episode => episode._id.toString() === _id);
		return episodeKey != -1;
	});
	return [seasonKey, episodeKey];
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
		seasonKey
	} = req.body;

	let set;

	try {
		let movie = await Movie.findOne({ _id: movieId });
		if(!movie) {
			return resError({
				res,
				alert: true,
				msg: 'Страница была удалена'
			});
		} else if(name == 'series' && movie.categoryAlias != 'serials' || name == 'films' && movie.categoryAlias != 'films') {
			return resError({
				res,
				alert: true,
				msg: 'Жанр страницы был изменён'
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
				if(movie[name] && movie[name].status) {
					let msg;
					switch(movie[name].status) {
						case 'removing':
							msg = 'Трейлер уже удаляется';
							break;
						case 'uploading':
							msg = 'Трейлер уже загружается';
							break;
						case 'ready':
							msg = 'Трейлер уже был добавлен';
							break;
						default: break;
					}
					return resError({ res, alert: true, msg });
				}
				set = { $set: { trailer: videoParams } };
				break;
			case 'films':
				if(movie[name] && movie[name][0]) {
					let msg;
					switch(movie[name][0].status) {
						case 'removing':
							msg = 'Фильм уже удаляется';
							break;
						case 'uploading':
							msg = 'Фильм уже загружается';
							break;
						case 'ready':
							msg = 'Фильм уже был добавлен';
							break;
						default: break;
					}
					return resError({ res, alert: true, msg });
				}
				set = { $addToSet: { films: videoParams } };
				break;
			case 'series':
				if(typeof seasonKey === undefined || seasonKey < 0) {
					return resError({
						res, 
						alert: true,
						msg: 'Указан неверный ключ сезона'
					});
				}

				if(seasonKey > 0 && !movie.series[seasonKey - 1]) {
					return resError({
						res, 
						alert: true,
						msg: 'Необходимо создать предыдущий сезон'
					});
				}

				// Добавить новую серию в конец запрашиваемого сезона
				const pushEpisode = () => {
					set = { $push: { [`series.${seasonKey}`]: videoParams } };
				};

				let [recheckedSeasonKey, episodeKey] = findSeasonAndEpisode(movie, _id);
				if(recheckedSeasonKey == -1 || episodeKey == -1) {
					pushEpisode();
				} else {
					switch(movie[name][recheckedSeasonKey][episodeKey].status) {
						case 'removing':
							return resError({
								res, 
								alert: true,
								msg: 'Эта серия уже удаляется'
							});
						case 'uploading':
							return resError({
								res, 
								alert: true,
								msg: 'Эта серия уже загружается'
							});
						case 'ready':
							const pathToOldVideoSrc = movie[name][recheckedSeasonKey][episodeKey].src;
							const pathToOldThumbnail = movie[name][recheckedSeasonKey][episodeKey].thumbnail;

							// Обновить статус видео
							await Movie.updateOne(
								{ _id: movieId },
								{ $set: { [`series.${recheckedSeasonKey}.${episodeKey}.status`]: 'removing' } }
							);

							// Удаление старых файлов
							if(pathToOldVideoSrc) await deleteFolderFromS3(pathToOldVideoSrc);
							if(pathToOldThumbnail) await deleteFileFromS3(pathToOldThumbnail);

							// Снова найти информацию о странице (её могли удалить или порядок серий мог поменяться)
							movie = await Movie.findOne({ _id: movieId });
							if(!movie) {
								return resError({
									res,
									alert: true,
									msg: 'Страница была удалена'
								});
							}

							[recheckedSeasonKey, episodeKey] = findSeasonAndEpisode(movie, _id);
							if(recheckedSeasonKey == -1 || episodeKey == -1) {
								pushSeries();
							} else {
								// Заменить старую серию
								set = { $set: { [`series.${recheckedSeasonKey}.${episodeKey}`]: videoParams } };
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
 * Обновление прогресса загрузки видеофрагментов
 */
router.post('/video/progress', verify.token, verify.isManager, async (req, res) => {
	const {
		_id,
		name,
		movieId
	} = req.body;

	try {
		let movie = await Movie.findOne({ _id: movieId });
		if(!movie) {
			return resError({
				res,
				alert: true,
				msg: 'Страница была удалена'
			});
		} else if(name == 'series' && movie.categoryAlias != 'serials' || name == 'films' && movie.categoryAlias != 'films') {
			return resError({
				res,
				alert: true,
				msg: 'Жанр страницы был изменён'
			});
		}

		let firstSet;

		switch(name) {
			case 'trailer':
				if(movie[name] && movie[name].status == 'uploading') {
					firstSet = { $inc: { 'trailer.uploaded': 1 } };
				}
				break;
			case 'films':
				const filmKey = findFilm(movie, _id);
				if(filmKey != -1 && movie[name][filmKey].status == 'uploading') {
					firstSet = { $inc: { [`films.${filmKey}.uploaded`]: 1 } };
				}
				break;
			case 'series':
				const [seasonKey, episodeKey] = findSeasonAndEpisode(movie, _id);
				if(seasonKey != -1 && episodeKey != -1 && movie[name][seasonKey][episodeKey].status == 'uploading') {
					firstSet = { $inc: { [`series.${seasonKey}.${episodeKey}.uploaded`]: 1 } };
				}
				break;
			default: break;
		}

		if(firstSet) {
			// Увеличить количество загруженных файлов на 1
			movie = Movie.findOneAndUpdate({ _id: movieId }, firstSet);

			let secondSet;

			// Перепроверка изменений
			switch(name) {
				case 'trailer':
					const trailer = movie[name];
					if(trailer && trailer.status == 'uploading' && trailer.uploaded >= trailer.total) {
						secondSet = {
							$set: { 'trailer.status': 'ready' },
							$min: { 'trailer.uploaded': trailer.total }
						};
					}
					break;
				case 'films':
					const filmKey = findFilm(movie, _id);
					if (filmKey == -1) break;

					const film = movie[name][filmKey];
					if(film.status == 'uploading' && film.uploaded >= trailer.total) {
						secondSet = {
							$set: { [`films.${filmKey}.status`]: 'ready' },
							$min: { [`films.${filmKey}.uploaded`]: film.total }
						};
					}
					break;
				case 'series':
					const [seasonKey, episodeKey] = findSeasonAndEpisode(movie, _id);
					if (seasonKey == -1 || episodeKey == -1) break;

					const episode = movie[name][seasonKey][episodeKey];
					if(episode.status == 'uploading' && episode.uploaded >= episode.total) {
						secondSet = {
							$set: { [`series.${seasonKey}.${episodeKey}.status`]: 'ready' },
							$min: { [`series.${seasonKey}.${episodeKey}.uploaded`]: episode.total }
						};
					}
					break;
				default: break;
			}

			// Изменить статус видео, если оно загружено до конца
			if(secondSet) await Movie.updateOne({ _id: movieId }, secondSet);
		}

		return res.status(200).json();
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
		interrupted
	} = req.body;

	try {
		const movie = await Movie.findOne({ _id: movieId });
		if(!movie) {
			return resError({
				res,
				alert: true,
				msg: 'Страница была удалена'
			});
		} else if(name == 'series' && movie.categoryAlias != 'serials' || name == 'films' && movie.categoryAlias != 'films') {
			return resError({
				res,
				alert: true,
				msg: 'Жанр страницы был изменён'
			});
		}

		let updateSet, deleteSet;

		// Пути видео и миниатюры для удаления
		let pathToOldVideoSrc;
		let pathToOldThumbnail;

		switch(name) {
			case 'trailer':
				if(!movie[name]) break;

				switch(movie[name].status) {
					case 'removing':
						return resError({
							res, 
							alert: true,
							msg: 'Трейлер уже удаляется'
						});
					case 'uploading':
						if (!interrupted) {
							return resError({
								res, 
								alert: true,
								msg: 'Трейлер уже загружается'
							});
						}
					case 'ready':
						updateSet = { $set: { 'trailer.status': 'removing' } };
						deleteSet = { $unset: { trailer: {} } };

						pathToOldVideoSrc = movie[name].src;
						pathToOldThumbnail = movie[name].thumbnail;
						break;
					default: break;
				}
				break;
			case 'films':
				const filmKey = findFilm(movie, _id);
				if(filmKey == -1) break;

				switch(movie[name][filmKey].status) {
					case 'removing':
						return resError({
							res, 
							alert: true,
							msg: 'Фильм уже удаляется'
						});
					case 'uploading':
						if (!interrupted) {
							return resError({
								res, 
								alert: true,
								msg: 'Фильм уже загружается'
							});
						}
					case 'ready':
						updateSet = { $set: { [`films.${filmKey}.status`]: 'removing' } };
						deleteSet = { $pull: { films: { _id } } };
	
						pathToOldVideoSrc = movie[name][filmKey].src;
						pathToOldThumbnail = movie[name][filmKey].thumbnail;
						break;
					default: break;
				}
				break;
			case 'series':
				const [seasonKey, episodeKey] = findSeasonAndEpisode(movie, _id);
				if(seasonKey == -1 || episodeKey == -1) break;

				switch(movie[name][seasonKey][episodeKey].status) {
					case 'removing':
						return resError({
							res, 
							alert: true,
							msg: 'Эта серия уже удаляется'
						});
					case 'uploading':
						if (!interrupted) {
							return resError({
								res, 
								alert: true,
								msg: 'Эта серия уже загружается'
							});
						}
					case 'ready':
						updateSet = { $set: { [`series.${seasonKey}.${episodeKey}.status`]: 'removing' } };
						deleteSet = { $pull: { [`series.${seasonKey}`]: { _id } } };

						pathToOldVideoSrc = movie[name][seasonKey][episodeKey].src;
						pathToOldThumbnail = movie[name][seasonKey][episodeKey].thumbnail;
						break;
					default: break;
				}
				break;
			default: break;
		}

		// Обновить статус видео
		if(updateSet) await Movie.updateOne({ _id: movieId }, updateSet);

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