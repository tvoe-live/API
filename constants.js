module.exports = Object.freeze({
	AMOUNT_LOGIN_WITHOUT_CAPTCHA: 3, // Количество попыток авторизации без каптчи

	USER_MAX_SESSIONS: 0, // Максимальное количество сессий (без ограничений)
	USER_MAX_SESSION_DAYS: 90, // Максимальное количество дней жизни сессии пользователя

	REFERRAL_PERCENT_BONUSE: 30, // Процент бонуса в реф. программе
	FIRST_STEP_REFERRAL: 20, // Процент бонуса первого уровня в реф. программе
	SECOND_STEP_REFERRAL: 10, // Процент бонуса второго уровня в реф. программе

	// Задачи для CRON
	CRON_TASKS: [
		{
			name: 'reccurentPayment', // Создание рекуррентного платежа
			period: '*/15 * * * * *', // Каждые 15 секунд
		},
		{
			name: 'repayment', // Автосписание
			period: '0 */8 * * *', // Каждые 8 часов
		},
		{
			name: 'resetMovieBadgeMovieTask', // Сбросить бейдж фильму при заврешении времени
			period: '0 */1 * * *', // Каждый час
		},
		{
			name: 'resetOldSessions', // Сбросить сессию пользователю при заврешении времени
			period: '0 4 */1 * *', // В 4 утра каждый день
		},
		{
			name: 'resetSubscribes', // Сбросить подписку пользователю при заврешении времени
			period: '*/1 * * * *', // Каждую минуту
		},
		{
			name: 'autoTransitionTariff', // Автопереход с пробного тарифа на платный
			period: '*/5 * * * * *', //5s
			//period: "*/5 * * * * *" // Каждые 5 минут
		},
	],
})
