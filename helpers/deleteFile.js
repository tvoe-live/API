const { S3_UPLOAD_KEY, S3_UPLOAD_SECRET, S3_UPLOAD_REGION, S3_UPLOAD_BUCKET, S3_UPLOAD_ENDPOINT } =
	process.env
const fs = require('fs')
const customS3Client = require('./customS3Client')
const { ListObjectsCommand, DeleteObjectCommand } = require('@aws-sdk/client-s3')

const client = customS3Client({
	region: S3_UPLOAD_REGION,
	endpoint: S3_UPLOAD_ENDPOINT,
	credentials: {
		accessKeyId: S3_UPLOAD_KEY,
		secretAccessKey: S3_UPLOAD_SECRET,
	},
})

/*
 * Очистка папки для и ее удаление в S3
 */
const deleteFolderFromS3 = async (Prefix) => {
	if (Prefix.charAt(0) == '/') Prefix = Prefix.substr(1)

	try {
		while (true) {
			const listObjectsCommand = new ListObjectsCommand({
				Prefix,
				Bucket: S3_UPLOAD_BUCKET,
			})
			const listedObjects = await client.send(listObjectsCommand)

			if (!listedObjects.Contents || listedObjects.Contents.length === 0) break

			listedObjects.Contents.forEach(async (obj) => await deleteFileFromS3(obj.Key))
		}
	} catch (e) {
		console.log(e)
	}
}

/*
 * Удаление файла с S3
 */
const deleteFileFromS3 = async (Key) => {
	try {
		const command = new DeleteObjectCommand({
			Key,
			Bucket: S3_UPLOAD_BUCKET,
		})

		const res = await client.send(command)

		return res
	} catch (err) {
		console.log(err)
	}
}

module.exports = {
	deleteFileFromS3,
	deleteFolderFromS3,
}
