const {
	TMP_DIR,
	IMAGES_DIR,
	VIDEOS_DIR,
	S3_UPLOAD_KEY,
	S3_UPLOAD_SECRET,
	S3_UPLOAD_REGION,
	S3_UPLOAD_BUCKET,
	S3_UPLOAD_ENDPOINT
} = process.env;
const fs = require('fs');
const path = require('path');
const mongoose = require('mongoose');
const resError = require('./resError');
const cpuCount = require("os").cpus().length;
const { Upload } = require('@aws-sdk/lib-storage');
const customS3Client = require('./customS3Client');
const ffmpeg = require('../custom_modules/node-ffmpeg');

// Получение уникального ID от базы данных
const getObjectId = () => new mongoose.Types.ObjectId();

// Параметры для разного качества видео
const renditions = [
	{ p: 360, w: 640, h: 360, maxrate: 856, bufsize: 1200, ab: 128 },
	{ p: 480, w: 864, h: 486, maxrate: 1498, bufsize: 2100, ab: 128 },
	{ p: 720, w: 1280, h: 720, maxrate: 2996, bufsize: 4200, ab: 196 },
	{ p: 1080, w: 1920, h: 1080, maxrate: 5350, bufsize: 7500, ab: 320 },
	{ p: 1440, w: 2560, h: 1440, maxrate: 7200, bufsize: 9200, ab: 560 }, // Не проверено
	{ p: 2160, w: 3840, h: 2160, maxrate: 9600, bufsize: 12000, ab: 1000 } // Не проверено
];

const ffrun = (video, options, output) => new Promise((resolve, reject) => {
	for (const option of options) video.addCommand(...option);
	video.save(output, error => error ? reject(error) : resolve());
});

/*
* Генерация миниатюр и превью
* На выходе файлы:
*	f-%d.jpg - фрагменты миниатюр при перемотке
*	thumbnails.txt - файл разметки миниатюр
*	preview.jpg - превью видео
*/
const generatePreview = async ({ video, videoDuration, resultPath }) => {
	const previewWidth = 640;
	const previewHeight = 360;
	const previewFileName = `${getObjectId()}.jpg`;
	const randomInt = max => Math.floor(Math.random() * Math.floor(max));

	await ffrun(video, [
		['-ss', videoDuration / 3 + randomInt(videoDuration / 10)],
		['-vf', `scale=w=${previewWidth}:h=${previewHeight}:force_original_aspect_ratio=decrease`], ['-frames:v', 1]
	], `${resultPath}/${previewFileName}`);

	return { previewFileName }
}

/*
* Генерация миниатюр и превью
* На выходе файлы:
*	f-%d.jpg - фрагменты миниатюр при перемотке
*	thumbnails.txt - файл разметки миниатюр
*	preview.jpg - превью видео
*/
const generateThumbnails = async ({ video, videoDuration, resultPath }) => {
	let countThumbnailsParts;
	const thumbnailsWidth = 160;
	const thumbnailsHeight = 90;
	const thumbnailsFileName = 'thumbnails.txt';

	// Частота кадров в зависимости от длительности видео
	switch(true) {
		case videoDuration < 120: countThumbnailsParts = 2; break;
		case videoDuration < 240: countThumbnailsParts = 3; break;
		case videoDuration < 480: countThumbnailsParts = 4; break;
		case videoDuration < 600: countThumbnailsParts = 5; break;
		case videoDuration < 1800: countThumbnailsParts = 10; break;
		case videoDuration < 3600: countThumbnailsParts = 20; break;
		case videoDuration < 7200: countThumbnailsParts = 30; break;
		case videoDuration < 14400: countThumbnailsParts = 60; break;
		case videoDuration < 57600: countThumbnailsParts = 120; break;
		default: countThumbnailsParts = 180;
	}

	// Создание файлов склеек миниатюр
	await ffrun(video, [
		['-vf', `select="isnan(prev_selected_t)+gte(t-prev_selected_t\\,${countThumbnailsParts}),scale=${thumbnailsWidth}:${thumbnailsHeight},tile=5x5"`],
		['-vsync', 'vfr']
	], `${resultPath}/f-%d.jpg`);

	// Создание файла разметки миниатюр
	const end = Number(fs.readdirSync(resultPath).length),
	sec = Math.ceil((videoDuration + 1) / countThumbnailsParts);
	let text = 'WEBVTT', time = 0;
	
	for (let i = 0; i < end; ++i) {
		const countMath = Math.min(25, sec - i * 25);
		for (let j = 0; j < countMath; ++j) {
			const next = time + countThumbnailsParts - 1, o = [
				Math.floor(time / 3600), Math.floor(time / 60), time % 60,
				Math.floor(next / 3600), Math.floor(next / 60), next % 60
			]; o.forEach((e, i) => o[i] = String(e).padStart(2, '0'));
			text += `\n${o[0]}:${o[1]}:${o[2]}.000 --> ${o[3]}:${o[4]}:${o[5]}.999\nf-${i + 1}.jpg#xywh=${j % 5 * thumbnailsWidth},${Math.floor(j / 5) * thumbnailsHeight},${thumbnailsWidth},${thumbnailsHeight}`;
			time += countThumbnailsParts;
		}
	}

	fs.writeFileSync(`${resultPath}/${thumbnailsFileName}`, text);

	return { thumbnailsFileName }
}

/*
* Конвертация MP4 в HLS на сервере
* На выходе файлы:
* 	[Индекс].m3u8 - мастеры для разных качеств
*	[Индекс]-%d.ts - фрагменты для HLS
*/

const convertVideoToHLS = async ({ video, resultPath, videoResolution }) => {
	const threads = cpuCount > 3 ? cpuCount - 2 : 1;

	const options = [
		['-threads', threads], // Ограничение на количество потоков процессора
		['-pix_fmt', 'yuv420p'], // Матрица 4:4:4
		['-preset', 'medium'], ['-profile:v', 'high'], ['-level', 3.1], // Совместимость с телефонами и Смарт-ТВ
		['-color_primaries', 1], ['-color_trc', 1], ['-colorspace', 1], // Цвет BT.709
		['-keyint_min', 48], ['-g', 48], // Расстояние между ключевыми кадрами
		['-sc_threshold', 0], // Чувствительность смены сцен
		['-hls_time', 4], // Длительность фрагмента
		['-hls_playlist_type', 'vod'], // Плейлист VOD
		['-hls_allow_cache', 1], // Кэшировать загруженные сегменты
		['-hls_segment_filename', `${resultPath}/%v-%d.ts`] // Название фрагмента
    ], stream = [], qualities = [];

	// Генерация HLS
	for (let i = 0; i < renditions.length; ++i) {
		if(renditions[i].w > videoResolution.w && renditions[i].h > videoResolution.h) break;

		const map = [`v:${i}`];
		options.push(
			[`-filter:v:${i}`, `scale=w=${renditions[i].w}:h=${renditions[i].h}:force_original_aspect_ratio=decrease`],
			['-map', '0:v:0']
		);

		if(video.metadata.audio.channels.value) {
			options.push(['-map', '0:a:0']);
			map.push(`a:${i}`);
		}

		stream.push(map.join());

		// Записать парметры видео для БД
		qualities.push({
			p: renditions[i].p,
			w: renditions[i].w,
			h: renditions[i].h
		})
	}

	options.push(['-var_stream_map', '"' + stream.join(' ') + '"']);

	await ffrun(video, options, `${resultPath}/%v.m3u8`);

	return { qualities };
};

/*
 * Загрузка каждого файла в S3
 */
const sendFilesToS3 = async ({ src, resultPath }) => {
	const kit = [];

	for (const file of fs.readdirSync(resultPath)) {
		kit.push(new Promise(async resolve => {
			const filePath = `${resultPath}/${file}`;
			const fileBody = fs.readFileSync(filePath);

			// Удаление файла
			if(fs.existsSync(filePath)) fs.rmSync(filePath, { force: true });

			let extn = file.split('.').pop();
			let ContentType = 'application/octet-stream';
			if (extn == 'html') ContentType = "text/html";
			if (extn == 'css') ContentType = "text/css";
			if (extn == 'js') ContentType = "application/javascript";
			if (extn == 'png' || extn == 'jpg' || extn == 'gif') ContentType = "image/" + extn;

			const params = {
				Body: fileBody,
				ContentType,
				Key: `${src}/${file}`,
				Bucket: S3_UPLOAD_BUCKET
			}

			const parallelUploads3 = new Upload({
				client: customS3Client({
					region: S3_UPLOAD_REGION,
					endpoint: S3_UPLOAD_ENDPOINT,
					credentials: {
						accessKeyId: S3_UPLOAD_KEY,
						secretAccessKey: S3_UPLOAD_SECRET,
					},
					...params
				}),
				params,
				queueSize: 4,
				partSize: 50 * 1024 * 1024,
				leavePartsOnError: false,
			});

			await parallelUploads3.done();

			//console.log('sended', file)

			resolve()
		}));
	}

	await Promise.all(kit)
}

const getVideoDuration = (raw) => {
	const colons = raw.split(':');
	const duration = (+colons[0]) * 60 * 60 + (+colons[1]) * 60 + (+colons[2]); 

	return duration
}

/*
 * Загрузка видео
 */
const uploadVideoToS3 = async ({ res, tmpVideoPath }) => {
	try {
		const id = getObjectId(); // ID нового видео для БД
		const name = path.parse(tmpVideoPath).name; // Название виддео без расширения
		const src = `${VIDEOS_DIR}/${name}`; // Путь хранения в S3
		const resultPath = `${TMP_DIR}/${name}`; // Путь к HLS на сервере

		const video = await new ffmpeg(tmpVideoPath);
		const videoDuration = getVideoDuration(video.metadata.duration.raw);
		const videoResolution = video.metadata.video.resolution;

		if(videoResolution.w < renditions[0].w && videoResolution.h < renditions[0].h) {
			if(fs.existsSync(tmpVideoPath)) fs.rmSync(tmpVideoPath, { recursive: true, force: true });

			return resError({
				res, 
				alert: true,
				msg: 'Плохое качество видео'
			});
		}

		// Создание папки для нового видео
		fs.mkdirSync(`${TMP_DIR}/${name}`);

		// Генерация превью
		const { previewFileName } = await generatePreview({
			video,
			resultPath,
			videoDuration
		})

		// Отправить превью в /images S3
		await sendFilesToS3({ src: IMAGES_DIR, resultPath });

		// Генерация миниатюр
		await generateThumbnails({
			video,
			resultPath,
			videoDuration
		})

		// Конвертирование MP4 в HLS
		let qualities;

		convertVideoToHLS({
			video,
			resultPath,
			videoDuration,
			videoResolution
		}).then(({ qualities: q }) => {
			qualities = q;
		}, error => resError({
			res,
			alert: true,
			msg: 'Не удалось сконвертировать видео'
		}));

		// Загрузка каждого файла в S3 (параллельно)
		await new Promise(resolve => {
			(check = async () => {
				// тут можно сделать отловку ошибок
				await sendFilesToS3({ src, resultPath });

				qualities ? resolve() : setTimeout(check, 1000);
			})();
		});


		if(fs.readdirSync(resultPath).length) await sendFilesToS3({ src, resultPath });

		// Удаление временных MP4 и HLS на сервере
		if(fs.existsSync(resultPath)) fs.rmSync(resultPath, { recursive: true, force: true });
		if(fs.existsSync(tmpVideoPath)) fs.rmSync(tmpVideoPath, { recursive: true, force: true });

		return {
			id,
			src,
			qualities,
			duration: videoDuration,
			previewSrc: `${IMAGES_DIR}/${previewFileName}`,
		}
	} catch(err) {
		console.log(err)
	}
}

module.exports = {
	uploadVideoToS3
};