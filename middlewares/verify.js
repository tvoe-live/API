const jwt = require('jsonwebtoken')
const User = require('../models/user')
const AuthLog = require('../models/authLog')

const getCookie = (name, cookie) => {
	const matches = cookie.match(
		new RegExp('(?:^|; )' + name.replace(/([\.$?*|{}\(\)\[\]\\\/\+^])/g, '\\$1') + '=([^;]*)')
	)
	return matches ? decodeURIComponent(matches[1]) : undefined
}

const logout = async ({ res, userId, token }) => {
	if (userId) {
		// Логирование на выход из сессии
		new AuthLog({
			token,
			userId,
			type: 'LOGOUT',
		}).save()

		await User.updateOne(
			{ _id: userId },
			{
				$pull: {
					sessions: { token },
				},
			}
		)
	}

	res.cookie('token', '', {
		maxAge: -1,
		domain: process.env.HOSTNAME,
	})
}

const token = async (req, res, next) => {
	let token

	if (req.headers.authorization) {
		token = req.headers.authorization
	} else if (req.headers.cookie) {
		token = getCookie('token', req.headers.cookie)
	} else if (req.headers.token) {
		token = req.headers.token
	}

	if (!token && res) {
		return res.status(401).json({
			code: 401,
			type: 'error',
			message: 'Не удалось получить токен',
		})
	}

	try {
		const decodedData = jwt.verify(token, process.env.JWT_TOKEN_SECRET, {
			algorithms: 'HS256',
		})

		let userId = decodedData.id

		if (!userId && res) {
			await logout({ res, userId, token })

			return res.status(401).json({
				code: 401,
				type: 'error',
				message: 'Пользователь не авторизован',
			})
		}

		let user = await User.findOneAndUpdate(
			{ _id: userId },
			{ $set: { lastVisitAt: Date.now() } },
			{
				timestamps: false,
				returnOriginal: false,
				$project: {
					__v: false,
					_sex: false,
					_email: false,
					_birthday: false,
					_firstname: false,
					_lastname: false,
					_displayName: false,
					sex: false,
					birthday: false,
					lastname: false,
					createdAt: false,
					updatedAt: false,
					lastVisitAt: false,
					displayName: false,
				},
			}
		)

		const isSession = user.sessions.find((session) => session.token === token)

		if (!isSession && res) {
			await logout({ res, userId, token })

			return res.status(401).json({
				code: 401,
				type: 'error',
				message: 'Сессия не найдена',
			})
		}

		if (!user && res) {
			await logout({ res, userId, token })

			return res.status(401).json({
				code: 401,
				type: 'error',
				message: 'Пользователь не найден',
			})
		}

		if (user.subscribe && new Date() >= user.subscribe.finishAt) {
			user.subscribe = null

			await User.updateOne({ _id: userId }, { $unset: { subscribe: null } }, { timestamps: false })
		}

		user.token = token

		req.user = user

		next && next()
	} catch (error) {
		console.log(error)
		if (!res) return

		//await logout({ res });

		return res.status(401).json({
			error,
			code: 401,
			type: 'error',
			message: 'Неопознанная ошибка',
		})
	}
}

const roleError = (res) =>
	res.status(401).json({
		code: 401,
		type: 'error',
		message: 'Недостаточно прав',
	})

const isAdmin = async (req, res, next) => {
	if (req.user.role !== 'admin') return roleError(res)

	next()
}

const isManager = async (req, res, next) => {
	if (req.user.role !== 'manager' && req.user.role !== 'admin') return roleError(res)

	next()
}

module.exports = {
	token,
	isAdmin,
	isManager,
}
