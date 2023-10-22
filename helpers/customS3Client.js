const { S3Client } = require('@aws-sdk/client-s3')

const customS3Client = (data) => {
	const client = new S3Client({
		s3ForcePathStyle: true,
		...data,
	})

	return client
}

module.exports = customS3Client
