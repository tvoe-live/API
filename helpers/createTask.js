const cron = require('node-cron')
const cronTaskModel = require('../models/cronTask')

/**
 * Класс-помошник для управления скроновскими задачами
 */
class Tasks {
	constructor(_prefix) {
		this.prefix = _prefix
		cronTaskModel
			.find({ prefix: _prefix }, { _id: false, __v: false })
			.then((res) => (this.tasks = res))
	}

	tasks
	prefix

	/**
	 * Метод для создания новой задачи
	 *
	 * @param {String} id - идентификатор по которому можно найти задачу
	 * @param {String} period - указание периода/времени выполнения задачи в cron-формате
	 * @param {Function} callback - анонимная функция, которая будет выполнятся
	 * @returns созданную задачу (по умолчанию она не запущенная)
	 */
	createTask = async (id = null, period, callback, isStart = false) => {
		const task = cron.schedule(period, callback, {
			scheduled: isStart ? true : false,
			name: `${prefix}-${id}`,
		})

		await cronTaskModel.create({
			id: id ? `${prefix}-${id}` : `${prefix}-${this.tasks.length}`,
			period,
		})

		this.tasks.push({
			id: id ? `${prefix}-${id}` : `${prefix}-${this.tasks.length}`,
			period,
		})

		return task
	}

	/**
	 *
	 * @param {String} id - Идентификатор по котораму будет искаться задача
	 * @returns Возвращает найденную задачу
	 */
	stopTask = (id) =>
		this.tasks.find((item) => item.id === `${prefix}-${id}` && cron.getTasks[item.id].stop())

	getTask = (id) =>
		this.tasks.find((item) => {
			if (item.id === `${this.prefix}-${id}`) {
				return cron.getTasks[item.id]
			}
		})

	/**
	 *
	 * @param {String} id - идентификатор задачи, которая будет изменена
	 * @param {Object} newTask - данные новой задачи (новый период и новый колбек)
	 * @returns возвращает новую задачу (по умолчанию не запущенна)
	 */
	changeTask = async (id, newTask, isStart = false) => {
		for (const item of this.tasks) {
			if (item.id === `${prefix}-${id}`) {
				cron.getTasks[item.id].stop()

				item.period = newTask.period
				const task = cron.schedule(newTask.period, newTask.callback, {
					scheduled: isStart ? true : false,
					name: `${prefix}-${id}`,
				})

				await item.save()
				task.start()

				return task
			}
		}
	}

	/**
	 *
	 * @param {String} id
	 */
	deleteTask = async (id) => {
		for (const item of this.tasks) {
			if (item.id === `${prefix}-${id}`) {
				cron.getTasks[item.id].stop()
				item.isDeleted = true
				await item.save()
			}
		}
	}
}

module.exports = {
	Tasks,
}
