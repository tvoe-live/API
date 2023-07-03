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
	const { movieId } = req.query;

	if(movieId) return next()

	const newMovie = await Movie.create({
		raisedUpAt: new Date(),
		creatorUserId: req.user._id
	})

	req.query.movieId = newMovie._id

	next()
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
		S3_UPLOAD_ENDPOINT
	});
});

/*
 * Загрузка обложки, постера или логотипа
 */
router.post('/image', verify.token, verify.isManager, existMovie, uploadMemoryStorage.single('file'), async (req, res) => {
	const { buffer } = req.file;
	const { name, movieId } = req.query;

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
		fragments,
		seasonKey,
		episodeKey
	} = req.query

	const videoParams = {
		_id: getObjectId(),
		duration: +duration,
		src: `/videos/${getObjectId()}`,
		qualities: qualities ? qualities.split(',') : [],
		audio: audio ? audio.split(',') : [],
		subtitles: subtitles ? subtitles.split(',') : [],
		thumbnail: `/images/${getObjectId()}.jpg`,
		fragments
	}
	console.log(fragments);

	let set;

	try {
		switch(name) {
			case 'trailer': 
				set = { $set: { trailer: videoParams } }
				break
			case 'films': 
				set = { $addToSet: { films: videoParams } }
				break
			case 'series': 
				const movie = await Movie.findOne({ _id: movieId });
				const previousSeason = movie.series[seasonKey - 1];

				if(!movie.series || !movie.series.length) await Movie.updateOne({ _id: movieId }, { $set: { series: [] } })

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


				let pathToOldVideoSrc;
				let pathToOldThumbnail;

				// Проверка на существование серии
				movie[name].find(season => {
					const found = season.find(series => series._id.toString() === _id);
				
					if(found) {
						pathToOldVideoSrc = found.src;
						pathToOldThumbnail = found.thumbnail;
					}
				});

				// Удаление старых файлов
				if(pathToOldVideoSrc) await deleteFolderFromS3(pathToOldVideoSrc);
				if(pathToOldThumbnail) await deleteFileFromS3(pathToOldThumbnail);

				// Заменить старую серию, либо добавить новую в конец
				if(pathToOldVideoSrc || pathToOldThumbnail) {
					set = { $set: { [`series.${seasonKey}.${episodeKey}`]: videoParams } }
				} else {
					set = { $push: { [`series.${seasonKey}`]: videoParams } }
				}

				break
			default: break
		}

		// Добавление / обновление ссылки на фаил в БД
		await Movie.updateOne({ _id: movieId }, set);

		return resSuccess({
			res,
			movieId,
			...videoParams
		})
	} catch(err) {
		return resError({ res, msg: err });
	}
});

/*
 * Удаление изображений
 */
router.delete('/image', verify.token, verify.isManager, async (req, res) => {
	const { name, movieId } = req.query;

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
	} = req.query;

	let set;

	try {
		switch(name) {
			case 'trailer': 
				set = { $unset: { trailer: {} } }
				break
			case 'films': 
				set = { 
					$pull: {
						films: { _id }
					}
				}
				break;
			case 'series': 
				const seriesId = mongoose.Types.ObjectId(_id);

				set = { 
					$pull: {
						[`series.${seasonKey}`]: { _id: seriesId }
					}
				}
				break;
			default: break;
		}

		// Удаление ссылки на фаил в БД
		const movie = await Movie.findOneAndUpdate({ _id: movieId }, set)

		// Удаление пустых массивов
		if(name === 'series') {
			await Movie.updateOne(
				{ _id: movieId }, 
				{ $pull: {
					series: { $in:[[]] }
				} },
				{ multi: true }
			)
		}

		// Пути видео и миниатюры для удаления
		let pathToOldVideoSrc
		let pathToOldThumbnail

		switch(name) {
			case 'trailer': 
				pathToOldVideoSrc = movie[name].src;
				pathToOldThumbnail = movie[name].thumbnail;
				break;
			case 'films': 
				pathToOldVideoSrc = movie[name].find(film => film._id.toString() === _id).src;
				pathToOldThumbnail = movie[name].find(film => film._id.toString() === _id).thumbnail;
				break;
			case 'series': 
				movie[name].find(season => {
					const found = season.find(series => series._id.toString() === _id);
				
					if(found) {
						pathToOldVideoSrc = found.src;
						pathToOldThumbnail = found.thumbnail;
					}
				});
				break;
			default: break;
		}

		// Удаление старых файлов
		if(pathToOldVideoSrc) await deleteFolderFromS3(pathToOldVideoSrc);
		if(pathToOldThumbnail) await deleteFileFromS3(pathToOldThumbnail);

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