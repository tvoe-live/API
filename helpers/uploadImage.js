const {
	STATIC_DIR,
	IMAGES_DIR, 
	S3_UPLOAD_KEY,
	S3_UPLOAD_SECRET,
	S3_UPLOAD_REGION,
	S3_UPLOAD_BUCKET,
	S3_UPLOAD_ENDPOINT
} = process.env;
const sharp = require('sharp');
const mongoose = require('mongoose');
const resError = require('./resError');
const { Upload } = require('@aws-sdk/lib-storage');
const customS3Client = require('./customS3Client');

// Получение уникального ID от базы данных
const getObjectId = () => new mongoose.Types.ObjectId();

/*
 * Загрузка картинок на диск сервера
 */
const uploadImageOnDisk = async ({
	res,
	path,
	width, 
	height,
	buffer,
	type = 'jpg',
	fit = 'cover'
}) => {
	if(!path && !buffer) 
		return resError({
			res, 
			alert: true,
			msg: 'Фаил не получен'
		});

	try {
		const id = getObjectId();
		const name = `${getObjectId()}.${type}`;
		const src = `${IMAGES_DIR}/${name}`;

		// Конвертирование в JPEG с сжатием без потерь
		await sharp(path || buffer)
		.resize({
			fit,
			width,
			height
		})
		.toFormat(type)
		.toFile(STATIC_DIR + src);

		return {
			fileId: id,
			fileSrc: src,
			fileName: name
		}
	} catch(err) {
		console.log(err)
	}
}

// Временное решение!
// Загрузка картинок на диск сервера
const uploadImageToS3 = async ({
	res,
	path,
	width, 
	height,
	buffer,
	type = 'jpg',
	fit = 'cover'
}) => {
	return await uploadImageOnDisk({
		res,
		path,
		width, 
		height,
		buffer,
		type,
		fit
	})
};

/*
 * Загрузка картинок в S3
 */
// const uploadImageToS3 = async ({ 
// 	res,
// 	width, 
// 	height,
// 	buffer,
// 	type = 'jpg',
// 	fit = 'cover'
// }) => {
// 	if(!buffer) 
// 		return resError({
// 			res, 
// 			alert: true,
// 			msg: 'Фаил не получен'
// 		});

// 	try {
// 		const id = getObjectId();
// 		const mimeType = `image/${type}`;
// 		const name = `${getObjectId()}.${type}`;
// 		const src = `${IMAGES_DIR}/${name}`;

// 		// Конвертирование в JPEG с сжатием без потерь
// 		const file = await sharp(buffer)
// 		.resize({
// 			fit,
// 			width,
// 			height
// 		})
// 		.toFormat(type)
// 		.toBuffer()

// 		const params = {
// 			Body: file,
// 			Key: src,
// 			ContentType: mimeType,
// 			Bucket: S3_UPLOAD_BUCKET
// 		}

// 		const parallelUploads3 = new Upload({
// 			client: customS3Client({
// 				region: S3_UPLOAD_REGION,
// 				endpoint: S3_UPLOAD_ENDPOINT,
// 				credentials: {
// 					accessKeyId: S3_UPLOAD_KEY,
// 					secretAccessKey: S3_UPLOAD_SECRET,
// 				},
// 				...params
// 			}),
// 			params,
// 			queueSize: 4,
// 			partSize: 50 * 1024 * 1024,
// 			leavePartsOnError: false,
// 		});

// 		await parallelUploads3.done();

// 		return {
// 			fileId: id,
// 			fileSrc: src,
// 			fileName: name
// 		}
// 	} catch(err) {
// 		console.log(err)
// 	}
// }

module.exports = {
	uploadImageToS3,
	uploadImageOnDisk
}
