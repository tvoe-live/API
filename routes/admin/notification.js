const express = require('express')
const router = express.Router()
const resError = require('../../helpers/resError')
const Notification = require('../../models/notification')
const getSearchQuery = require('../../middlewares/getSearchQuery')
const verify = require('../../middlewares/verify')

// const resSuccess = require('../../helpers/resSuccess')
// const getBoolean = require('../../helpers/getBoolean')
// const mongoose = require('mongoose')

/*
 *  Уведомления
 */

/*
 * Список всех уведомлений
 */
router.get('/', getSearchQuery, verify.token, verify.isAdmin, async (req, res) => {
	const skip = +req.query.skip || 0
	const limit = +(req.query.limit > 0 && req.query.limit <= 20 ? req.query.limit : 20)

	const query = req.searchQuery?.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
	const editSpace = query?.replace(/ /gi, '\\s.*')
	const RegExpQuery = new RegExp(editSpace?.replace(/[eё]/gi, '[её]'), 'i')

	try {
		Notification.aggregate(
			[
				{
					$facet: {
						totalSize: [
							{
								$match: {
									deleted: { $ne: true },
									...(RegExpQuery && { title: RegExpQuery }),
								},
							},
							{
								$group: {
									_id: null,
									count: { $sum: 1 },
								},
							},
							{ $project: { _id: false } },
							{ $limit: 1 },
						],
						items: [
							{
								$match: {
									deleted: { $ne: true },
									...(RegExpQuery && { title: RegExpQuery }),
								},
							},
							{
								$project: {
									receiversIds: false,
									__v: false,
									createdAt: false,
								},
							},
							{
								$addFields: {
									status: {
										$cond: {
											if: {
												$or: [
													// Если этого поля не существует или оно равно null
													{ $eq: ['$willPublishedAt', null] },
													{ $eq: [{ $ifNull: ['$willPublishedAt', null] }, null] },
												],
											},
											then: 'сохранено',
											else: {
												$cond: {
													if: { $gt: ['$willPublishedAt', new Date()] },
													then: 'отложено',
													else: 'опубликовано',
												},
											},
										},
									},
								},
							},
							{ $skip: skip },
							{ $limit: limit },
						],
					},
				},
				{ $unwind: { path: '$totalSize', preserveNullAndEmptyArrays: true } },
				{
					$project: {
						totalSize: { $cond: ['$totalSize.count', '$totalSize.count', 0] },
						items: '$items',
					},
				},
			],
			async (err, result) => {
				console.log('result:', result)
				return res.status(200).json(result[0])
			}
		)
	} catch (err) {
		return resError({ res, msg: err })
	}
})

module.exports = router
