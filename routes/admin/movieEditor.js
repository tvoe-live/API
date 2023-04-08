const {
	IMAGES_DIR,
	VIDEOS_DIR,
	STATIC_DIR,
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
const { uploadImageOnDisk } = require('../../helpers/uploadImage');
const { deleteFileFromDisk } = require('../../helpers/deleteFile');

/*
 * Админ-панель > Редактор медиа страницы
 */

// Получение уникального ID от базы данных
const getObjectId = () => new mongoose.Types.ObjectId();

// Загрузка картинок в буффер
const memoryStorage = multer.memoryStorage();
const uploadMemoryStorage = multer({ storage: memoryStorage });

// Загрузка видео сразу на диск
const diskStorage = multer.diskStorage({
	destination: (req, file, cb) => {
		let dir;

		if(file.fieldname === 'thumbnail') {
			dir = IMAGES_DIR;
		} else if(file.fieldname === 'video') {
			dir = VIDEOS_DIR;
		}

		cb(null, STATIC_DIR + dir);
	},
	filename: (req, file, cb) => {
		const fileType = file.mimetype.split('/')[1];
		const newFileName = getObjectId();

		cb(null, `${newFileName}.${fileType}`)
	}
});
const uploadDiskStorage = multer({ storage: diskStorage })

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
 * Создание медиа страницы, если ее не существует
 */
const existMovie = async (req, res, next) => {
	const { movieId } = req.query;

	if(movieId) return next()

	const newMovie = await Movie.create({
		creatorUserId: req.user._id
	})

	req.query.movieId = newMovie._id

	next()
}

/*
 * Загрузка обложки, постера или логотипа
 */
router.post('/image', verify.token, verify.isManager, existMovie, uploadMemoryStorage.single('file'), async (req, res) => {
	const { buffer } = req.file;
	const { name, movieId } = req.query;

	const { fileId, fileSrc } = await uploadImageOnDisk({
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
	if(pathToOldFile) await deleteFileFromDisk(pathToOldFile)

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
router.post('/video', 
	verify.token, 
	verify.isManager, 
	existMovie, 
	uploadDiskStorage.fields([
		{ name: 'thumbnail', maxCount: 1 },
		{ name: 'video', maxCount: 1 }
	]),
	async (req, res) => {

	const {
		name,
		movieId,
		seasonKey,
		episodeKey,
		videoWidth,
		videoHeight,
		videoDuration,
		videoExtension,
	} = req.query

	const {
		path: thumbnailTempPath,
		filename: thumbnailTempFileName
	} = req.files.thumbnail[0]
	
	const { fileSrc: thumbnailSrc } = await uploadImageOnDisk({
		width: 640,
		path: thumbnailTempPath
	})

	await deleteFileFromDisk(`${IMAGES_DIR}/${thumbnailTempFileName}`)

	const videoFileId = getObjectId();
	//const videoFileName = `${videoFileId}.${videoExtension}`;
	const videoFileName = req.files.video[0].filename;
	const videoFileSrc = `${VIDEOS_DIR}/${videoFileName}`;

	const videoParams = {
		_id: videoFileId,
		src: videoFileSrc,
		width: videoWidth,
		height: videoHeight,
		duration: videoDuration,
		thumbnail: thumbnailSrc
	}

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

				set = { $push: { [`series.${seasonKey}`]: [videoParams] } }
				break
			default: break
		}

		// Добавление / обновление ссылки на фаил в БД
		await Movie.updateOne({ _id: movieId }, set);

		return resSuccess({
			res,
			movieId,
			_id: videoFileId,
			src: videoFileSrc
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
		if(pathToOldFile) await deleteFileFromDisk(pathToOldFile)

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
		seasonKey
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
				set = { 
					$pull: {
						[`series.${seasonKey}`]: { _id }
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
		let pathToOldVideo
		let pathToOldThumbnail

		switch(name) {
			case 'trailer': 
				pathToOldVideo = movie[name].src;
				pathToOldThumbnail = movie[name].thumbnail;
				break;
			case 'films': 
				pathToOldVideo = movie[name].find(film => film._id.toString() === _id).src;
				pathToOldThumbnail = movie[name].find(film => film._id.toString() === _id).thumbnail;
				break;
			case 'series': 
				movie[name].find(season => {
					const found = season.find(series => series._id.toString() === _id);
				
					if(found) {
						pathToOldVideo = found.src;
						pathToOldThumbnail = found.thumbnail;
					}
				});
				break;
			default: break;
		}

		// Удаление старых файлов
		if(pathToOldVideo) await deleteFileFromDisk(pathToOldVideo);
		if(pathToOldThumbnail) await deleteFileFromDisk(pathToOldThumbnail);

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
		if(logo && logo.src) await deleteFileFromDisk(logo.src);
		// Удаление обложки
		if(cover && cover.src) await deleteFileFromDisk(cover.src);
		// Удаление постера
		if(poster && poster.src) await deleteFileFromDisk(poster.src);
		
		if(trailer) {
			// Удаление трейлера
			if(trailer.src) await deleteFileFromDisk(trailer.src);
			// Удаление миниатюры трейлера
			if(trailer.thumbnail) await deleteFileFromDisk(trailer.thumbnail);
		}

		if(films) {
			films.map(async film => {
				// Удаление всех фильмов
				if(film.src) await deleteFileFromDisk(film.src);
				// Удаление всех миниатюр фильмов
				if(film.thumbnail) await deleteFileFromDisk(film.thumbnail);
			});
		}

		if(series) {
			series.map(season => {
				season.map(async series => {
					// Удаление всех серий
					if(series.src) await deleteFileFromDisk(series.src);
					// Удаление всех миниатюр серий
					if(series.thumbnail) await deleteFileFromDisk(series.thumbnail);
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