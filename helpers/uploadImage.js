const { S3_UPLOAD_KEY, S3_UPLOAD_SECRET, S3_UPLOAD_REGION, S3_UPLOAD_BUCKET, S3_UPLOAD_ENDPOINT } =
	process.env
const sharp = require('sharp')
const mongoose = require('mongoose')
const resError = require('./resError')
const { Upload } = require('@aws-sdk/lib-storage')
const customS3Client = require('./customS3Client')

// Получение уникального ID от базы данных
const getObjectId = () => new mongoose.Types.ObjectId()

/*
 * Загрузка картинок в S3
 */
const uploadImageToS3 = async ({ res, width, height, buffer, type = 'jpg', fit = 'cover' }) => {
	if (!buffer)
		return resError({
			res,
			alert: true,
			msg: 'Фаил не получен',
		})

	try {
		const id = getObjectId()
		const mimeType = `image/${type}`
		const name = `${getObjectId()}.${type}`
		const src = `/images/${name}`

		// Конвертирование в JPEG с сжатием без потерь
		const file = await sharp(buffer)
			.resize({
				fit,
				width,
				height,
			})
			.toFormat(type)
			.toBuffer()

		const params = {
			Body: file,
			Key: src,
			ContentType: mimeType,
			Bucket: S3_UPLOAD_BUCKET,
		}

		const parallelUploads3 = new Upload({
			client: customS3Client({
				region: S3_UPLOAD_REGION,
				endpoint: S3_UPLOAD_ENDPOINT,
				credentials: {
					accessKeyId: S3_UPLOAD_KEY,
					secretAccessKey: S3_UPLOAD_SECRET,
				},
				...params,
			}),
			params,
			isMultiPart: false,
			partSize: 1024 ** 3,
		})

		await parallelUploads3.done()

		return {
			fileId: id,
			fileSrc: src,
			fileName: name,
		}
	} catch (err) {
		console.log(err)
	}
}

module.exports = {
	uploadImageToS3,
}
