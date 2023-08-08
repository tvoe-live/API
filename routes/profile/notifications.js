const express = require('express');
const router = express.Router();
const verify = require('../../middlewares/verify');
const resError = require('../../helpers/resError');
const Notification = require('../../models/notification');
const resSuccess = require('../../helpers/resSuccess');

/*
 * Уведомления
 */


/*
 * Список уведомлений для пользователя
 */
router.get('/', verify.token, async (req, res) => {
	const skip = +req.query.skip || 0
	const limit = +(req.query.limit > 0 && req.query.limit <= 100 ? req.query.limit : 100);


	// const agregationListForTotalSize = [
	// 	{ $lookup: {
	// 		from: "moviefavorites",
	// 		localField: "_id",
	// 		foreignField: "movieId",
	// 		pipeline: [
	// 			{ $match: { 
	// 				userId: req.user._id,
	// 				isFavorite: true
	// 			} },
	// 			{ $sort: { updatedAt: -1 } }
	// 		],
	// 		as: "favorite"
	// 	} },
	// 	{ $unwind: "$favorite" },
	// ]
	
	const lookup = [
		{ $lookup: {
			from: "moviefavorites",
			localField: "_id",
			foreignField: "movieId",
			pipeline: [
				{ $match: { 
					userId: req.user._id,
					isFavorite: true
				} },
				{ $sort: { updatedAt: -1 } }
			],
			as: "favorite"
		} },
		{ $unwind: "$favorite" },
	]

	try {
		Notification.aggregate([
			{
				"$facet": {
					// "totalSize":[
					// 	...agregationListForTotalSize,
					// 	{ $group: { 
					// 		_id: null, 
					// 		count: { $sum: 1 }
					// 	} },
					// 	{ $project: { _id: false } },
					// 	{ $limit: 1 }
					// ],
					"items": [
						// { $match: {

						// } },
						...lookup,
						...movieOperations({
							addToProject: {
							poster: { src: true },
							addedToFavoritesAt: "$favorite.updatedAt"
							},
							skip,
							limit
						}),
						{ $sort: { addedToFavoritesAt: -1 } },
					]
				},
			},
			// { $unwind: { path: "$totalSize", preserveNullAndEmptyArrays: true } },
			{ $project: {
				// totalSize: { $cond: [ "$totalSize.count", "$totalSize.count", 0] },
				items: "$items"
			} },
		], (err, result)=>{
			return res.status(200).json(result[0]);
		});

	} catch(err) {
		return resError({ res, msg: err });
	}


	// try {
		

	// 	return res.status(200).json(result);

	// } catch(err) {
	// 	return resError({ res, msg: err });
	// }
})


/*
 * Пометить уведомления прочитанными
 */
router.patch('/markAsRead', verify.token, async (req, res) => {

	try {

	} catch(err) {
		return resError({ res, msg: err });
	}
})

/*
 * Создать уведомления
 */
router.post('/', verify.token, verify.isManager, async (req, res) => {

	const {
		title,
		description,
		type,
		willPublishedAt
	} = req.body

	if(!title) return resError({ res, msg: 'Не передан title' });
	if(!type) return resError({ res, msg: 'Не передан type' });
	if(!willPublishedAt) return resError({ res, msg: 'Не передана дата и время публикации - параметр willPublishedAt' });
		
	try {
		const response = await Notification.create({
				title,
				description,
				type,
				willPublishedAt: new Date(willPublishedAt)
		});

		//Получить id всех юзеров
		//Преобразовать в стркутуру для инсертМени
		
		const respons2e = await Notification.insertMany([]);

		return res.status(200).json({
			success: true,
			id: response._id,
			title,
			description,
			type,
			willPublishedAt
		});

	} catch(err) {
		console.log('err:', err)
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
	
		// Удаление записи из БД
		await Notification.deleteOne({ _id });

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

module.exports = router;