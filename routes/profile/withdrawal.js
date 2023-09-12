const express = require("express");
const mongoose = require("mongoose");
const router = express.Router();
const resError = require("../../helpers/resError");
const resSuccess = require("../../helpers/resSuccess");
const WithdrawalLog = require("../../models/withdrawalLog");
const verify = require("../../middlewares/verify");

/*
 *  Возврат денежных средств
 */

/*
 * Получение последней записи для юзера
 */
router.get("/", verify.token, async (req, res) => {
	try {
		const withdrawalLog = await WithdrawalLog.findOne({
			userId: req.user._id,
			status: "WAITING",
		});

		if (!withdrawalLog) {
			return resError({
				res,
				alert: true,
				msg: "В данный момент нет заявки, находящейся в режиме ожидания",
			});
		}

		return res.status(200).json({
			_id: withdrawalLog._id,
			reason: withdrawalLog.reason,
			status: withdrawalLog.status,
			createdAt: withdrawalLog.createdAt,
		});
	} catch (err) {
		return resError({ res, msg: err });
	}
});

/*
 * Добавление записи
 */
router.post("/", verify.token, async (req, res) => {
	const { reason } = req.body;

	try {
		const existWithdrawalLog = await WithdrawalLog.findOne({
			userId: req.user._id,
			status: "WAITING",
		});
		if (existWithdrawalLog)
			return resError({
				res,
				alert: true,
				msg: "Ваша заявка на вывод средств уже создана и находится в режиме ожидания",
			});

		const { _id } = await WithdrawalLog.create({
			userId: req.user._id,
			status: "WAITING",
			reason,
		});

		return resSuccess({
			_id,
			res,
			status: "WAITING",
			reason,
			alert: true,
			msg: "Заявка на вывод средств успешно cоздана",
		});
	} catch (error) {
		return res.json(error);
	}
});

/*
 * Редактирование записи
 */
router.patch("/", verify.token, verify.isManager, async (req, res) => {
	let { status, _id } = req.body;

	if (!status) {
		return resError({
			res,
			alert: true,
			msg: "Поле status обязательное",
		});
	}

	try {
		const withdrawalLog = await WithdrawalLog.findOneAndUpdate(
			{
				_id: mongoose.Types.ObjectId(_id),
			},
			{
				$set: {
					status,
					managerUserId: req.user._id,
				},
				$inc: { __v: 1 },
			},
		);

		if (!withdrawalLog) {
			return resError({
				res,
				alert: true,
				msg: "Заявки с указанным _id не найдено",
			});
		}
		return resSuccess({
			_id,
			res,
			alert: true,
			msg: "Заявка на вывод средств успешно обновлена",
		});
	} catch (error) {
		return res.json(error);
	}
});

module.exports = router;
