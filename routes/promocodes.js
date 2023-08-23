const express = require('express');
const router = express.Router();
const verify = require('../middlewares/verify');
const resError = require('../helpers/resError');
const Promocod = require('../models/promocod')
const PromocodesLog = require('../models/promocodLog')

const resSuccess = require('../helpers/resSuccess');
const getBoolean = require('../helpers/getBoolean');
const mongoose = require('mongoose');

/*
 * Уведомления
 */

/*
 * Список всех промокодов
 */
router.get('/', verify.token, async (req, res) => {
	const skip = +req.query.skip || 0
	const limit = +(req.query.limit > 0 && req.query.limit <= 20 ? req.query.limit : 20);

	const isActive = getBoolean(req.query.isActive)

	const match =  {$match: {
		$and: [
			{startAt: { $lte: new Date() }},
			{finishAt: { $gte: new Date() }},
			{deleted:{$ne: true}}
		]
	}}

	try {
		Promocod.aggregate([
			{
				"$facet": {
					"totalSize": [
						...(isActive ? [match] : []),
						{ $group: {
							_id: null,
							count: { $sum: 1 }
						} },
						{ $project: { _id: false } },
						{ $limit: 1 }
					],
					"items": [
						...(isActive ? [match] : []),
						{ $sort: { createdAt: -1 } },
						{$project: {
							updatedAt: false,
							__v:false,
						}},
						{ $skip: skip },
						{ $limit: limit },
					]
				},
			},
			{ $unwind: { path: "$totalSize", preserveNullAndEmptyArrays: true } },
			{ $project: {
				totalSize: { $cond: [ "$totalSize.count", "$totalSize.count", 0] },
				items: "$items",
			} },
		], async(err, result)=>{
			return res.status(200).json(result[0]);
		});

	} catch(err) {
		return resError({ res, msg: err });
	}
})


/*
 *  Активировать промокод
 */
router.patch('/activate', verify.token, async (req, res) => {

	const value = req.body.value

	try {
		const promocod = await Promocod.findOne({value})

		if (!promocod || promocod.startAt > new Date() || promocod.deleted){
			return resError({ res, msg: 'Указанного промокода не существует' });
		}

		if (promocod.finishAt < new Date()){
			return resError({ res, msg: 'Срок действия указанного промокода истек' });
		}

		const promocodLog = await PromocodesLog.findOne({promocodId:promocod._id, userId: req.body._id})
		if (promocodLog){
			return resError({ res, msg: 'Промокод был уже использован ранее!' });
		}

		// здесь должен быть какой то код для получения выгоды от промокода юзеру. Например активирует бесплатную подписку или дает скидку на тариф.

		// Создание лога об активации промокода
		await PromocodesLog.create({promocodId:promocod._id, userId: req.body._id})

		return resSuccess({
			res,
			alert: true,
			msg: 'Промокод успешно активирован'
		})

	} catch(err) {
		return resError({ res, msg: err });
	}
})

/*
 * Создать промокод
 */

router.post('/', verify.token, verify.isManager, async (req, res) => {

	const {
		title,
		value,
		type,
		startAt,
		finishAt,
	} = req.body

	if(!title) return resError({ res, msg: 'Не передан title' });
	if(!value) return resError({ res, msg: 'Не передан value' });
	if(!type) return resError({ res, msg: 'Не передан type' });
	if(!startAt) return resError({ res, msg: 'Не передана дата и время начала действия промокода - параметр startAt' });
	if(!finishAt) return resError({ res, msg: 'Не передана дата и время начала действия промокода - параметр finishAt' });

	try {
		const response = await Promocod.create({
				title,
				value,
				type,
				startAt: new Date(startAt),
				finishAt: new Date(finishAt),
		});
		
		return res.status(200).json({
			success: true,
			value,
			type,
			startAt,
			finishAt,
		});

	} catch(err) {
		return resError({ res, msg: err });
	}
})

/*
 * Изменить промокод
 */
router.patch('/', verify.token, async (req, res) => {

	const {
		_id,
		title,
		value,
		type,
		startAt,
		finishAt,
	} = req.body

	try {

		const promocod = await Promocod.findOne({ _id });

		if (!promocod){
			return resError({ res, msg: 'Промокода с указанным _id не найдено' });
		}

		if (title) promocod.title = title
		if (value) promocod.value = value
		if (type) promocod.type = type
		if (startAt) promocod.startAt = new Date(startAt)
		if (finishAt) promocod.finishAt = new Date(finishAt)

		promocod.save()

		return resSuccess({
			res,
			alert: true,
			msg: 'Промокод обновлен'
		})
	} catch(err) {
		return resError({ res, msg: err });
	}
})

/*
 * Удалить промокод
 */
router.delete('/', verify.token, verify.isManager, async (req, res) => {

	const {
		_id
	} = req.body

	if(!_id) return resError({ res, msg: 'Не передан _id' });

	try {
		const promocod = await Promocod.findOne({ _id });

		if (!promocod){
			return resError({ res, msg: 'Промокода с указанным _id не найдено' });
		}

		promocod.deleted = true
		promocod.save()

		return resSuccess({
			res,
			_id,
			alert: true,
			msg: 'Успешно удалено'
		})
	} catch(err) {
		return resError({ res, msg: err });
	}
})

/*
 *  Количество активаций у одного промокода
 */
router.get('/count', verify.token, verify.isManager, async (req, res) => {

	const {
		_id
	} = req.query

	if(!_id) return resError({ res, msg: 'Не передан _id' });

	try {
		const result = await PromocodesLog.aggregate([
			{ "$facet": {
				"totalSize": [
					{$match:{
						promocodId: mongoose.Types.ObjectId(_id)
					}},
					{ $group: {
						_id: null,
						count: { $sum: 1 }
					}},
					{ $limit: 1 },
				],
			}},
			{ $limit: 1 },
			{ $unwind: { path: "$totalSize", preserveNullAndEmptyArrays: true } },
			{ $project: {
				totalSize: { $cond: [ "$totalSize.count", "$totalSize.count", 0] },
				id:_id
			}},
		])

		return res.status(200).json(result[0]);

	} catch(err) {
		return resError({ res, msg: err });
	}
})


/*
 *  Количество активаций у всех промокодов
 */
router.get('/countAll', verify.token, verify.isManager, async (req, res) => {
	const skip = +req.query.skip || 0
	const limit = +(req.query.limit > 0 && req.query.limit <= 20 ? req.query.limit : 20);

	const lookup = {
		$lookup: {
			from: "promocodeslogs",
			localField: "_id",
			foreignField: "promocodId",
			as: "PromocodesLog"
		}
	}

	try {
		Promocod.aggregate([
			{
				"$facet": {
					"totalSize": [
						lookup,
						{ $group: {
							_id: null,
							count: { $sum: 1 }
						} },
						{ $project: { _id: false } },
						{ $limit: 1 }
					],
					"items":[
						lookup,
						{$sort: {updatedAt: -1}},
						{
							$project: {
								updatedAt:true,
								title:true,
								value:true,
								type:true,
								startAt:true,
								finishAt:true,
								watchingAmount: { $size: "$PromocodesLog" }
							}
						},
						{ $skip: skip },
						{ $limit: limit }
					],
				},
			},
			{ $limit: 1 },
			{ $unwind: { path: "$totalSize", preserveNullAndEmptyArrays: true } },
			{ $project: {
				totalSize: { $cond: [ "$totalSize.count", "$totalSize.count", 0] },
				items: "$items"
			} },
		], async(err, result)=>{
			return res.status(200).json(result[0]);
		});

	} catch(err) {
		return resError({ res, msg: err });
	}
})

module.exports = router;
