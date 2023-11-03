const cron = require('node-cron')
const cronTaskModel = require('../models/cronTask')

/**
 * Класс-помошник для управления кроновскими задачами
 */
class Tasks {
	constructor(_prefix) {
		this.prefix = _prefix
	}

	tasks = []
	prefix

	async init() {
		this.tasks = await cronTaskModel.find(
			{ prefix: this.prefix, isDeleted: false },
			{ _id: false, __v: false }
		)
	}

	static async restart(name, callback) {
		const tasks = await cronTaskModel.find({ prefix, name })
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
			name: id ? `${this.prefix}-${id}` : `${this.prefix}-${this.tasks.length}`,
		})

		await cronTaskModel.create({
			name,
			period,
		})

		this.tasks.push({
			name,
			period,
		})

		return this.tasks[this.tasks.length - 1].id
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
	stopTask = (id) =>
		this.tasks.find(
			(item) => item.id === `${this.prefix}-${id}` && cron.getTasks().get(item.id).stop()
		)

	/**
	 * Получить крон-задачу
	 *
	 * @param {String} id - Идентификатор по которому будет искаться задача
	 * @returns Найденную задачу
	 */
	getTask = (id) => cron.getTasks().get(`${this.prefix}-${id}`)

	/**
	 *
	 * @param {String} id - Идентификатор по котораму будет искаться задача
	 */
	deleteTask = async (id) => {
		for (const item of this.tasks) {
			if (item.id === `${prefix}-${id}`) {
				cron.getTasks().get(item.id).stop()
				item.isDeleted = true
				await item.save()
			}
		}
	}
}

module.exports = {
	Tasks,
}
