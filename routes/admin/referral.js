const express = require('express')
const router = express.Router()
const verify = require('../../middlewares/verify')
const resError = require('../../helpers/resError')
const Promocode = require('../../models/promocode')
const PromocodesLog = require('../../models/promocodeLog')
const User = require('../../models/user')
const getSearchQuery = require('../../middlewares/getSearchQuery')
const isValidObjectId = require('../../helpers/isValidObjectId')

const resSuccess = require('../../helpers/resSuccess')
const getBoolean = require('../../helpers/getBoolean')
const mongoose = require('mongoose')

/*
 * Админ панель => реферралы
 */

/*
 * Список всех пользователей, имеющих реферралов
 */
// router.get('/', verify.token, verify.isAdmin, getSearchQuery, async (req, res) => {
router.get('/', getSearchQuery, async (req, res) => {
	const skip = +req.query.skip || 0
	const limit = +(req.query.limit > 0 && req.query.limit <= 20 ? req.query.limit : 20)

	const searchMatch = req.RegExpQuery && {
		$or: [
			...(isValidObjectId(req.searchQuery)
				? [{ _id: mongoose.Types.ObjectId(req.searchQuery) }]
				: []),
			{ email: req.RegExpQuery },
			{ firstname: req.RegExpQuery },
		],
	}

	try {
		User.aggregate(
			[
				{
					$facet: {
						totalSize: [
							{
								$match: {
									'referral.userIds': { $ne: null },
									$expr: {
										$ne: [{ $size: '$referral.userIds' }, 0],
									},
									...searchMatch,
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
									'referral.userIds': { $ne: null },
									$expr: {
										$ne: [{ $size: '$referral.userIds' }, 0],
									},
									...searchMatch,
								},
							},
							{
								$lookup: {
									from: 'users',
									let: { usersIds: '$referral.userIds' },
									pipeline: [
										{ $match: { $expr: { $in: ['$_id', '$$usersIds'] } } },
										{
											$project: {
												email: true,
												phone: true,
												firstname: true,
												lastname: true,
												_id: true,
												subscribe: true,
											},
										},
										{
											$lookup: {
												from: 'tariffs',
												localField: 'subscribe.tariffId',
												foreignField: '_id',
												pipeline: [
													{
														$project: {
															_id: false,
															name: true,
														},
													},
												],
												as: 'tariff',
											},
										},
										{ $unwind: { path: '$tariff', preserveNullAndEmptyArrays: false } },
										{
											$addFields: {
												tariffName: '$tariff.name',
											},
										},
										{
											$project: {
												tariff: false,
											},
										},
										{
											$lookup: {
												from: 'paymentlogs',
												localField: '_id',
												foreignField: 'userId',
												pipeline: [
													{
														$match: {
															type: 'paid',
														},
													},
													{
														$project: {
															_id: false,
															status: true,
															createdAt: true,
															bonuseAmount: {
																// $multiply: ['$amount', +REFERRAL_PERCENT_BONUSE / 100],
																$multiply: ['$amount', +20 / 100],
															},
														},
													},
													{
														$match: {
															bonuseAmount: { $ne: null },
														},
													},
													{ $sort: { createdAt: -1 } },
												],
												as: 'payment',
											},
										},
									],
									as: 'referralUsers',
								},
							},
							{
								$project: {
									referral: true,
									referralUsers: true,
									firstname: true,
									lastname: true,
									email: true,
									_id: true,
									subscribe: true,
									phone: true,
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
