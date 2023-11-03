const cron = require('node-cron')
const cronTaskModel = require('../models/cronTask')

/**
 * Класс-помошник для управления кроновскими задачами
 */
class Tasks {
	tasks = []

	static async restart(name, callback) {
		const tasks = await cronTaskModel.find({ name, name })
		tasks.forEach((item) => cron.schedule(item.period, callback))
	}

	/**
	 * Метод для создания новой задачи
	 *
	 * @param {String} id - идентификатор по которому можно найти задачу
	 * @param {String} period - указание периода/времени выполнения задачи в cron-формате
	 * @param {Function} callback - анонимная функция, которая будет выполнятся
	 * @returns созданную задачу (по умолчанию она не запущенная)
	 */
	createTask = async (name, period, callback, isStart = false) => {
		cron.schedule(period, callback, {
			scheduled: isStart ? true : false,
			name,
		})

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
	 * Запустить крон-задачу
	 *
	 * @param {String} id - Идентификатор крон-задачи
	 * @returns
	 */
	startTask = (id) => cron.getTasks().get(id).start()

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
