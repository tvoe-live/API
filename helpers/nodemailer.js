const nodemailer = require('nodemailer')
require('dotenv').config()

const transporter = nodemailer.createTransport(
	{
		host: 'smtp.yandex.ru',
		port: 465,
		secure: true,
		auth: {
			user: process.env.EMAIL_LOGIN,
			pass: process.env.EMAIL_PASSWORD,
		},
	},
	{
		from: process.env.EMAIL_LOGIN,
	}
)

const mailer = (message) => {
	transporter.sendMail(message, (err, info) => {
		if (err) return console.log(err)
		//console.log('Email sent: ', info)
	})
}

module.exports = mailer
