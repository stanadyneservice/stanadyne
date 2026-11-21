# Заявки з сайту в Telegram

## 1. Створіть бота
1. У Telegram відкрийте @BotFather → `/newbot` → отримаєте **токен** (виглядає як `123456:ABC...`).
2. Відкрийте свого нового бота й натисніть **Start** (інакше він не зможе вам писати).

## 2. Дізнайтесь свій chat id
Напишіть боту @userinfobot — він відповість вашим числовим **Id**.
(Для групи: додайте бота в групу, chat id групи починається з `-100…`.)

## 3. Задайте змінні в Cloudflare Pages
Проєкт → Settings → Variables and Secrets (Production) → додайте як **Secret**:
- `TELEGRAM_BOT_TOKEN` = токен бота
- `TELEGRAM_CHAT_ID` = ваш chat id
- (необов'язково) `TURNSTILE_SECRET` = секрет Turnstile; site key вставте в `SITE_CONFIG.turnstileSiteKey` в `index.html`

Після додавання змінних зробіть новий деплой.

## 4. Публікація
Завантажте всю папку `site` (з `index.html` і `functions/`). Для функцій краще
підключити репозиторій GitHub або використати `wrangler pages deploy site`:
прямий Upload через сайт може не підхопити папку `functions`.

## Чому токен не в index.html
Усе, що в `index.html`, бачить кожен відвідувач. Хто знайде токен, зможе слати спам
від імені вашого бота. Тому токен лежить лише у функції на сервері.
