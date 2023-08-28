const express = require('express');
const router = express.Router();
const resError = require('../../helpers/resError');
const resSuccess = require('../../helpers/resSuccess');
const WithdrawalLog = require('../../models/withdrawalLog')
const verify = require('../../middlewares/verify');

/*
 *  Возврат денежных средств
*/


/*
 * Получение всех записей для юзера
 */
router.get('/', verify.token, async (req, res) => {
	const skip = +req.query.skip || 0
	const limit = +(req.query.limit > 0 && req.query.limit <= 20 ? req.query.limit : 20);

	try {
		WithdrawalLog.aggregate([
			{
				"$facet": {
					"totalSize": [
						{$match: {
							userId:req.user._id
						}},
						{ $group: {
							_id: null,
							count: { $sum: 1 }
						} },
						{ $project: { _id: false } },
						{ $limit: 1 }
					],
					"items":[
						{$match: {
							userId:req.user._id
						}},
						{$sort: {createdAt: -1}},
						{
							$project: {
								createdAt:true,
								updatedAt:true,
								status:true,
								reason:true,
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

});


/*
 * Добавление записи
 */
router.post('/', verify.token, async (req, res) => {

	const {
		status,
		reason
	} = req.body;

	if(!status) {
		return resError({
			res,
			alert: true,
			msg: 'Не получен status'
		});
	}

	if(!reason || !reason.type || !reason.text) {
		return resError({
			res,
			alert: true,
			msg: 'Значение обязательного поля reason не валидно. Параметр reason представляет собой объект с полями type и text'
		});
	}

	try {

		const {_id} = await WithdrawalLog.create({
			userId:req.user._id,
			status,
			reason
		});

		return resSuccess({
			_id,
			res,
			status,
			reason,
			alert: true,
			msg: 'Заявка на вывод средств успешно cоздана'
		})
	} catch (error) {
		return res.json(error);
	}
});

module.exports = router;
