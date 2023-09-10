const express = require('express');
const router = express.Router();
const multer = require('multer');
const User = require('../../models/user');
const verify = require('../../middlewares/verify');
const resError = require('../../helpers/resError');
const resSuccess = require('../../helpers/resSuccess');
const { uploadImageToS3 } = require('../../helpers/uploadImage');
const { deleteFileFromS3 } = require('../../helpers/deleteFile');

/*
 * Профиль > Основное
 */

// Загрузка картинок в буффер
const memoryStorage = multer.memoryStorage();
const uploadMemoryStorage = multer({ storage: memoryStorage });

// Получение профиля
router.get('/', verify.token, async (req, res) => {

	const user = await User.findOne(
		{ _id: req.user._id },
		{
			role: true,
			email: true,
			avatar: true,
			deleted: true,
			firstname: true,
			subscribe: true,
			allowTrialTariff: true,
			disabledNotifications:true,
		}
	);

	if(user.deleted) {
		if(new Date().getTime() > user.deleted.finish.getTime()) user.deleted.timeIsUp = true;
	}

	return res.status(200).json(user);
});

// Изменение профиля
router.patch('/', verify.token, async (req, res) => {

	let { firstname } = req.body;

	if (typeof(firstname)==='undefined'){
		return resError({
				res,
				alert: true,
				msg: 'Поле firstname обязательное'
			});
	}

	firstname = firstname.toString();

	if(firstname.length > 50) {
		return resError({
			res,
			alert: true,
			msg: 'Превышена длина поля: Имя пользователя'
		});
	}

	await User.updateOne(
		{ _id: req.user._id },
		{
			$set: { firstname },
			$inc: { '__v': 1 }
		}
	);

	return resSuccess({
		res,
		alert: true,
		msg: 'Имя пользователя обновлено'
	})
});

// Удаление профиля
router.delete('/', verify.token, async (req, res) => {

	const {
		_id,
		deleted
	} = req.user;

	if(deleted) {
		return resError({
			res,
			alert: true,
			msg: 'Профиль уже в режиме удаления'
		});
	}

	const now = new Date();
	const finish = now.setMonth(now.getMonth() + 1);

	const set = {
		deleted: {
			start: new Date(),
			finish: new Date(finish)
		}
	};

	await User.updateOne({ _id: _id }, { $set: set })

	return res.status(200).json({ ...set });
});

// Восстановление профиля
router.post('/recover', verify.token, async (req, res) => {

	const {
		_id,
		deleted
	} = req.user;

	if(new Date().getTime() > deleted.finish.getTime()) {
		return resError({
			res,
			alert: true,
			msg: 'Профиль уже полностью удален'
		});
	}

	const unset = {
		deleted: null
	}

	await User.updateOne({ _id: _id }, { $unset: unset })

	return res.status(200).json({ ...unset });
});

// Загрузка аватара
router.post('/avatar', verify.token, uploadMemoryStorage.single('file'), async (req, res) => {
	const { buffer } = req.file;
	const maxSizeMbyte = 5; // Лимит 5MB
	const maxSizeByte = maxSizeMbyte * 1024 * 1024;

	if(!buffer) return resError({ res, msg: 'Фаил не получен' });
	if(req.file.buffer.byteLength >= maxSizeByte) {
		return resError({
			res,
			alert: true,
			msg: `Размер файла не должен превышать ${maxSizeMbyte} МБ`
		});
	}

	const { fileSrc } = await uploadImageToS3({
		res,
		buffer,
		width: 100,
		height: 100,
		fit: 'fill'
	})

	// Добавление / обновление ссылки на фаил в БД
	const user = await User.findOneAndUpdate(
		{ _id: req.user._id },
		{ $set: {
			avatar: fileSrc
		} }
	);

	// Удаление старого файла
	if(user.avatar) await deleteFileFromS3(user.avatar)

	return resSuccess({
		res,
		alert: true,
		src: fileSrc,
		msg: 'Аватар обновлен'
	})
});

// Удаление аватара
router.delete('/avatar', verify.token, async (req, res) => {

	// Удаление ссылки на фаил в БД
	const user = await User.findOneAndUpdate(
		{ _id: req.user._id },
		{ $set: {
			avatar: null
		} }
	);

	// Удаление старого файла
	if(user.avatar) await deleteFileFromS3(user.avatar)

	return resSuccess({
		res,
		src: null,
		alert: true,
		msg: 'Аватар удален'
	})
});


module.exports = router;
