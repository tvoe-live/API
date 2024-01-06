module.exports = Object.freeze({
	AMOUNT_LOGIN_WITHOUT_CAPTCHA: 3, // Количество попыток авторизации без каптчи

	USER_MAX_SESSIONS: 0, // Максимальное количество сессий (без ограничений)
	USER_MAX_SESSION_DAYS: 90, // Максимальное количество дней жизни сессии пользователя

	REFERRAL_PERCENT_BONUSE: 30, // Процент бонуса в реф. программе
	FIRST_STEP_REFERRAL: 20, // Процент бонуса первого уровня в реф. программе
	SECOND_STEP_REFERRAL: 10, // Процент бонуса второго уровня в реф. программе

	NO_REPLY_EMAIL: 'no-reply@tvoe.team', // Почта для принятия любых незначимых или мусорных сообщений
	CONTENT_DEPARTMENT_EMAIL: 'content@tvoe.team', // Почта для принятия сообщений в отдел контента
	SUPPORT_DEPARTMENT_EMAIL: 'support@tvoe.team', // Почта для принятия сообщений в отдел технической поддержки

	// Задачи для CRON
	CRON_TASKS: [
		{
			name: 'reccurentPayment', // Создание рекуррентного платежа
			period: '*/1 * * * *', // Каждую минуту
		},
		{
			name: 'resetMovieBadge', // Сбросить бейдж фильму/сериалу при заврешении времени
			period: '0 4 */1 * *', // В 4 утра каждый день
		},
		{
			name: 'resetOldSession', // Сбросить сессию пользователю при заврешении времени
			period: '0 4 */1 * *', // В 4 утра каждый день
		},
	],
})
