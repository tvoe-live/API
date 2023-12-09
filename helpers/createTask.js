const cron = require('node-cron')
const { CRON_TASKS } = require('../constants')

/**
 * Класс-помошник для управления кроновскими задачами
 */
class Tasks {
	tasks = []

	static async restart(name, callback) {
		const task = CRON_TASKS.find((task) => task.name === name)

		cron.schedule(task.period, callback)
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
