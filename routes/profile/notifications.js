const express = require('express');
const router = express.Router();
const verify = require('../../middlewares/verify');
const resError = require('../../helpers/resError');
const Notification = require('../../models/notification');
const NotificationReadLog = require('../../models/notificationReadLog');
const resSuccess = require('../../helpers/resSuccess');
const multer = require('multer');
const mongoose = require('mongoose');
const { uploadImageToS3 } = require('../../helpers/uploadImage');

// Загрузка картинки в буффер
const memoryStorage = multer.memoryStorage();
const uploadMemoryStorage = multer({ storage: memoryStorage });

/*
 * Уведомления
 */

/*
 * Список уведомлений для пользователя
 */
router.get('/', verify.token, async (req, res) => {
	const skip = +req.query.skip || 0
	const limit = +(req.query.limit > 0 && req.query.limit <= 20 ? req.query.limit : 20);

	const lookupAndMatch = [
		{
			$match: {
				$or: [
					{ receiversIds: [] },           // Поле является пустым массивом
					{ receiversIds: { $elemMatch: { $eq: req.user._id } } } // Поле содержит заданный id
				]
			}
		},
		{ $lookup: {
			from: "notificationreadlogs",
			localField: "_id",
			foreignField: "notificationId",
			pipeline: [
				{ $match: {
					userId: req.user._id,
				} }
			],
			as: "notificationReadLog"
		} },
		{$match: {
			$expr: {
				$and:[
				  { $eq: [{ $size: "$notificationReadLog" }, 0]},  // Если записи в коллекции readlogs нет
				  { $gte: [new Date(), '$willPublishedAt']},
				  { $ne: ['$deleted', true]},
				]
			},
		}},
	]

	try {
		Notification.aggregate([
			{
				"$facet": {
					"totalSize":[
						...lookupAndMatch,
						{ $group: {
							_id: null,
							count: { $sum: 1 }
						} },
						{ $project: { _id: false } },
						{ $limit: 1 }
					],
					"items": [
						...lookupAndMatch,
						{$project: {
							updatedAt: false,
							createdAt:false,
							notificationReadLog:false,
							__v:false,
						}},
						{ $sort: { willPublishedAt: -1 } },
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
 * Пометить уведомления прочитанными
 */
router.patch('/markAsRead', verify.token, async (req, res) => {

	const NotificationReadLogForInsert = req.body.ids.map(notificationId=>({
		notificationId: mongoose.Types.ObjectId(notificationId),
		userId: mongoose.Types.ObjectId(req.user._id),
	}))

	try {
		await NotificationReadLog.insertMany(NotificationReadLogForInsert);

		return resSuccess({
			res,
			alert: true,
			msg: 'Успешно обновлено'
		})

	} catch(err) {
		return resError({ res, msg: err });
	}
})

/*
 * Создать уведомления
 */

router.post('/', verify.token, verify.isManager, uploadMemoryStorage.single('file'), async (req, res) => {
	const buffer = req?.file

	const {
		title,
		description,
		type,
		willPublishedAt,
		link,
		receiversIds
	} = req.body

	if(!title) return resError({ res, msg: 'Не передан title' });
	if(!type) return resError({ res, msg: 'Не передан type' });
	if(!willPublishedAt) return resError({ res, msg: 'Не передана дата и время публикации - параметр willPublishedAt' });

	let fileIdForDB
	let fileSrcForDB

	if (buffer){
		const { fileId, fileSrc } = await uploadImageToS3({
			res,
			buffer,
		})

		fileIdForDB = fileId
		fileSrcForDB = fileSrc
	}

	try {
		const response = await Notification.create({
				title,
				description,
				type,
				link,
				receiversIds,
				willPublishedAt: new Date(willPublishedAt),
				img: {
					_id: fileIdForDB,
					src: fileSrcForDB
				}
		});
		console.log('response:', response)
		return res.status(200).json({
			success: true,
			id: response._id,
			title,
			description,
			link,
			type,
			receiversIds,
			willPublishedAt,
			img: response.img
		});

	} catch(err) {
		return resError({ res, msg: err });
	}
})

/*
 * Изменить уведомление
 */
router.patch('/', verify.token, uploadMemoryStorage.single('file'), async (req, res) => {

	const buffer = req.file?.buffer
	const { title, description, _id, type, willPublishedAt, link, receiversIds } = req.body;

	try {

		const notification = await Notification.findOne({ _id });

		if (!notification){
			return resError({ res, msg: 'Уведомление с указанным _id не найдено' });
		}

		if (buffer){

			const pathToFileIng = notification?.src
			// Удаление файла картинки
			if(pathToFileIng) await deleteFileFromS3(pathToFileIng)

			const { fileId, fileSrc } = await uploadImageToS3({
				res,
				buffer,
			})

			notification.img = {
				_id: fileId,
				src: fileSrc
			}
		}

		if (title) notification.title = title
		if (description) notification.description = description
		if (type) notification.type = type
		if (willPublishedAt) notification.willPublishedAt = willPublishedAt
		if (link) notification.link = link
		if (receiversIds) notification.receiversIds = receiversIds

		notification.save()

		return resSuccess({
			res,
			alert: true,
			msg: 'Уведомление обновлено'
		})
	} catch(err) {
		return resError({ res, msg: err });
	}
})

/*
 * Удалить уведомления
 */
router.delete('/', verify.token, verify.isManager, async (req, res) => {

	const {
		_id
	} = req.body

	if(!_id) return resError({ res, msg: 'Не передан _id' });

	try {
		const notification = await Notification.findOne({ _id });

		if (!notification){
			return resError({ res, msg: 'Уведомление с указанным _id не найдено' });
		}

		const pathToFileIng = notification?.src
		// Удаление файла картинки
		if(pathToFileIng) await deleteFileFromS3(pathToFileIng)

		// Удаление записи из БД
		// notification.delete()
		notification.deleted = true
		notification.save()

		return resSuccess({
			res,
			_id,
			alert: true,
			msg: 'Успешно удалено'
		})
	} catch(err) {
		console.log('err:', err)
		return resError({ res, msg: err });
	}
})

/*
 *  Количество просмотров у одного уведомления
 */
router.get('/count', verify.token, verify.isManager, async (req, res) => {

	const {
		_id
	} = req.body

	if(!_id) return resError({ res, msg: 'Не передан _id' });

	try {
		const result = await NotificationReadLog.aggregate([
			{ "$facet": {
				"totalSize": [
					{$match:{
						notificationId: mongoose.Types.ObjectId(_id)
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
 *  Количество просмотров у всех уведомлений
 */
router.get('/countAll', verify.token, verify.isManager, async (req, res) => {
	const skip = +req.query.skip || 0
	const limit = +(req.query.limit > 0 && req.query.limit <= 20 ? req.query.limit : 20);

	const lookup = {
		$lookup: {
			from: "notificationreadlogs",
			localField: "_id",
			foreignField: "notificationId",
			as: "NotificationReadLog"
		}
	}

	try {
		Notification.aggregate([
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
								description:true,
								type:true,
								img:true,
								watchingAmount: { $size: "$NotificationReadLog" }
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
