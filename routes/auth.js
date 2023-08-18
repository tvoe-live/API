const express = require('express');
const router = express.Router();
const axios = require('axios');
const jwt = require('jsonwebtoken');
const mongoose = require('mongoose');
const User = require('../models/user');
const AuthLog = require('../models/authLog');
const verify = require('../middlewares/verify');
const resError = require('../helpers/resError');
const resSuccess = require('../helpers/resSuccess');
const { uploadImageToS3 } = require('../helpers/uploadImage');

/*
 * Авторизация / регистрация через Яндекс и разрушение сессии
 */

// Скачивание аватарки 
const downloadAvatar = async (res, default_avatar_id) => {
	try {
		const { data } = await axios({
			method: 'GET',
			url: `https://avatars.yandex.net/get-yapic/${default_avatar_id}/islands-retina-50`,
			responseType: 'arraybuffer',
		})

		if(!data) return null

		// Конвертирование в JPEG и запись картинки на диск
		const { fileSrc } = await uploadImageToS3({
			res,
			buffer: data,
			width: 100,
			height: 100,
			fit: 'fill'
		})

		return fileSrc
	} catch (err) {
		console.log(err)
	}
}

// Генерация токена
const generateAccessToken = (userId) => {
	const payload = { id: userId };

	return jwt.sign(payload, process.env.JWT_TOKEN_SECRET, {
		expiresIn: '1year',
		algorithm: 'HS256',
	});
};

router.post('/login', async (req, res) => {
	const refererUserId = req.header('refererUserId')
	const authorization = req.header('authorization')

	try {
		axios({
			method: 'GET',
			url: 'https://login.yandex.ru/info?format=json',
			headers: { 
				'Authorization': authorization
			}
		})
		.then(async (response) => {
			const { data } = response;

			if(!data.id) return res.status(400).json(data);
			
			const {
				id,
				sex,
				birthday,
				last_name,
				client_id,
				first_name,
				display_name,
				default_email,
				is_avatar_empty,
				default_avatar_id
			} = data;

			const defaultEmail = default_email.toLowerCase();

			// Поиск пользователя в БД
			let user = await User.findOne({ initial_id: id });
			
			// Если пользователя нет в БД, создаем нового
			if(!user) {
				// Получение уникального ID от базы данных
				const _id = new mongoose.Types.ObjectId();

				// Скачать аватар с поставщика регистрации
				const avatar = !is_avatar_empty ? await downloadAvatar(res, default_avatar_id) : null;

				// "initial" обозначаются неизменные данные от поставщика регистрации
				const registrationUserData = {
					_id,
					initial_id: id,
					initial_sex: sex,
					initial_birthday: birthday,
					initial_lastname: last_name,
					initial_email: defaultEmail,
					initial_client_id: client_id,
					initial_firstname: first_name,
					initial_displayName: display_name,

					sex: sex,
					avatar: avatar,
					birthday: birthday,
					lastname: last_name,
					email: defaultEmail,
					firstname: first_name,
					displayName: display_name,
					lastVisitAt: Date.now()
				}

				// Поиск пользователя в БД, который пригласил на регистрацию
				const refererUser = await User.findOneAndUpdate(
					{ _id: refererUserId },
					{ $addToSet: {
						'referral.userIds': _id
					} },
				);
				// Привязать пользователя к рефереру
				if(refererUser) registrationUserData.refererUserId = mongoose.Types.ObjectId(refererUserId)

				user = await new User(registrationUserData).save();
			}

			// Генерируем токен
			const userId = user._id;
			const token = await generateAccessToken(userId);

			await User.updateOne(
				{ _id: userId }, 
				{ $push: {
					sessions: {
						token,
						ip: req.ip,
						os: req.useragent.os,
						isBot: req.useragent.isBot,
						isMobile: req.useragent.isMobile,
						isDesktop: req.useragent.isDesktop,
						browser: req.useragent.browser,
						version: req.useragent.version,
						platform: req.useragent.platform,
						createdAt: Date.now()
					}
				} }
			);

			// Логирование на создание запроса авторизации
			await new AuthLog({
				token,
				userId,
				type: 'LOGIN'
			}).save();

			const hostname = process.env.HOSTNAME;
			const isLocalhost = hostname === 'localhost' || req.headers.origin.endsWith('ngrok-free.app');

			res.cookie('token', token, {
				path: '/',
				priority: 'high',
				domain: hostname,
				maxAge: 31536000000,
				secure: !isLocalhost,
				sameSite: isLocalhost ? 'lax' : 'none',
			});

			return res.status(200).json({ token });
		})
		.catch((err) => {
			return resError({ res, msg: err });
		});
	} catch (error) {
		return res.json(error);
	}
});


/*
 * Выход из сессии
 */

router.post('/logout', verify.token, async (req, res) => {
	const { token } = req.body;

	if(!token) {
		return resError({ 
			res, 
			alert: true,
			msg: 'Не получен токен'
		});
	}

	if(req.user.token === token) {
		res.cookie('token', '', {
			maxAge: -1,
			domain: process.env.HOSTNAME
		});
	}

	const isLogout = await User.findOne({ 
		_id: req.user._id, 
		sessions: {
			$elemMatch: { token }
		}
	});

	if(!isLogout) {
		return resError({
			res,
			alert: true,
			msg: 'Сессия уже разрушена'
		});
	}

	// Логирование на выход из сессии
	new AuthLog({
		token,
		type: 'LOGOUT',
		userId: req.user._id
	}).save();

	await User.updateOne(
		{ _id: req.user._id }, 
		{ $pull: {
			sessions: { token }
		} }
	);
	return resSuccess ({ res });
});

module.exports = router;