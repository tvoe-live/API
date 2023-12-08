const cron = require('node-cron')
// const schedule = require('node-schedule')

// const mailer = require('../helpers/nodemailer')

const cronTaskModel = require('../models/cronTask')
// const DisposableCronTask = require('../models/disposableCronTask')

/**
 * Класс-помошник для управления кроновскими задачами
 */
class Tasks {
	tasks = []

	static async restart(name, callback) {
		const tasks = await cronTaskModel.find({ name })
		tasks.forEach((item) => cron.schedule(item.period, callback))
	}

	// Функция для отправки смс на телефон и сообщений на почту уведомлений напоминаний об полном удалении аккаунта. Не стирается после перезапуска сервера. Может использоваться и для других целей
	// static async restartDisposable() {
	// 	const tasks = await DisposableCronTask.find({ willCompletedAt: { $gt: new Date() } })
	// 	console.log('tasks:', tasks)
	// 	tasks.forEach(({ name, phone, email, message, willCompletedAt }) => {
	// 		switch (name) {
	// 			case 'sendMsgViaPhone':
	// 				schedule.scheduleJob(new Date(willCompletedAt), async function () {
	// 					const response = await fetch(
	// 						`https://smsc.ru/sys/send.php?login=${process.env.SMS_SERVICE_LOGIN}&psw=${process.env.SMS_SERVICE_PASSWORD}&phones=${phone}&mes=${message}`
	// 					)
	// 				})
	// 				break
	// 			case 'sendMsgViaEmail':
	// 				const msg = {
	// 					to: email,
	// 					subject: 'Напоминание',
	// 					text: message,
	// 				}

	// 				schedule.scheduleJob(new Date(willCompletedAt), async function () {
	// 					mailer(msg)
	// 				})
	// 				break
	// 			default:
	// 				console.log('Ошибка внутри функции restartDisposable, несуществующий name:', name)
	// 		}
	// 	})
	// }

	/**
	 * Метод для создания новой задачи
	 *
	 * @param {String} name - имя шаблона задачи
	 * @param {String} period - указание периода/времени выполнения задачи в cron-формате

	 * @returns созданную задачу (по умолчанию она не запущенная)
	 */
	createTask = async (name, period) => {
		await cronTaskModel.create({
			name,
			period,
		})

		this.tasks.push({
			name,
			period,
		})

		return this.tasks[this.tasks.length - 1].name
	}

	/**
	 * Остановить крон-задачу
	 *
	 * @param {String} id - Идентификатор по котораму будет искаться задача
	 * @returns Возвращает найденную задачу
	 */
	stopTask = (name) =>
		this.tasks.find((item) => item.name === name && cron.getTasks().get(item.name).stop())

	/**
	 * Получить крон-задачу
	 *
	 * @param {String} id - Идентификатор по которому будет искаться задача
	 * @returns Найденную задачу
	 */
	getTask = (name) => cron.getTasks().get(name)
}

module.exports = {
	Tasks,
}
