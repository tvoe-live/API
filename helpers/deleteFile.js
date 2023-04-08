const {
	STATIC_DIR,
	S3_UPLOAD_KEY,
	S3_UPLOAD_SECRET,
	S3_UPLOAD_REGION,
	S3_UPLOAD_BUCKET,
	S3_UPLOAD_ENDPOINT
} = process.env;
const fs = require('fs');
const customS3Client = require('./customS3Client');
const { DeleteObjectCommand } = require('@aws-sdk/client-s3');

/*
 * Удаление файла с диска сервера
 */
const deleteFileFromDisk = async (path) => {
	try {
		if(fs.existsSync(STATIC_DIR + path)) {
			fs.unlinkSync(STATIC_DIR + path)
		} else {
			throw new Error(`Фаил ${STATIC_DIR + path} не существует`)
		}

		return path
	} catch(err) {
		console.log(err)
	}
}

/*
 * Удаление файла с s3
 */
const deleteFileFromS3 = async (Key) => {
	try {
		const client = customS3Client({
			region: S3_UPLOAD_REGION,
			endpoint: S3_UPLOAD_ENDPOINT,
			credentials: {
				accessKeyId: S3_UPLOAD_KEY,
				secretAccessKey: S3_UPLOAD_SECRET,
			}
		})

		const params = {
			Key,
			Bucket: S3_UPLOAD_BUCKET
		}

		const command = new DeleteObjectCommand(params);
		const res = await client.send(command);

		return res
	} catch(err) {
		console.log(err)
	}
}

module.exports = {
	deleteFileFromS3,
	deleteFileFromDisk
}
