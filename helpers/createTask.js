const cron = require('node-cron')
const cronTaskModel = require('../models/cronTask')

class Tasks {
	constructor(_prefix) {
		this.prefix = _prefix
		cronTaskModel
			.find({ prefix: _prefix }, { _id: false, __v: false })
			.then((res) => (this.tasks = res))
	}

	tasks
	prefix

	createTask = async (id = null, period, callback) => {
		const task = cron.schedule(period, callback, { scheduled: false, name: `${prefix}-${id}` })

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

	stopTask = (id) =>
		this.tasks.find((item) => item.id === `${prefix}-${id}` && cron.getTasks[item.id].stop())

	getTask = (id) =>
		this.tasks.find((item) => {
			if (item.id === `${this.prefix}-${id}`) {
				return cron.getTasks[item.id]
			}
		})

	changeTask = async (id, newTask) => {
		for (const item of this.tasks) {
			if (item.id === `${prefix}-${id}`) {
				cron.getTasks[item.id].stop()

				item.period = newTask.period
				const task = cron.schedule(newTask.period, newTask.callback, {
					scheduled: false,
					name: `${prefix}-${id}`,
				})

				await item.save()
				task.start()

				return task
			}
		}
	}

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
