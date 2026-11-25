# Telegram-бот блога «Следом»

Cloudflare Worker: принимает фото/видео/текст в Telegram и публикует моменты
в блог через GitHub API. Спецификация — в `../TELEGRAM_BOT.md`.

## Что умеет (MVP)

- Команды: `/trip`, `/city`, `/status`, `/trips`, `/date`, `/help`.
- Фото/видео с подписью → момент на сайте (~1 минута до деплоя).
- Альбомы (несколько фото одним сообщением) → один момент.
- Хэштеги в подписи → теги момента; `⭐` в начале → `best: true`.
- Текст без медиа → текстовая заметка.
- Приватность: принимает сообщения только от `TELEGRAM_ALLOWED_USER_ID`,
  webhook защищён секретом в пути.

## Развёртывание (один раз)

```bash
cd bot
npm install

# 1. Войти в Cloudflare (откроется браузер)
npx wrangler login

# 2. Создать KV и вписать id в wrangler.toml → KV_NAMESPACE_ID
npx wrangler kv namespace create BLOG_KV

# 3. Секреты
npx wrangler secret put TELEGRAM_BOT_TOKEN        # токен от @BotFather
npx wrangler secret put TELEGRAM_ALLOWED_USER_ID  # ваш ID от @userinfobot
npx wrangler secret put GITHUB_TOKEN              # fine-grained PAT: репо erozanov.github.io, Contents RW
npx wrangler secret put WEBHOOK_SECRET            # любая случайная строка

# 4. Деплой
npx wrangler deploy
# → выведет URL вида https://sledom-blog-bot.<subdomain>.workers.dev

# 5. Зарегистрировать webhook в Telegram
curl "https://api.telegram.org/bot<TELEGRAM_BOT_TOKEN>/setWebhook" \
  -d "url=https://sledom-blog-bot.<subdomain>.workers.dev/webhook/<WEBHOOK_SECRET>"
```

Проверка: `curl "https://api.telegram.org/bot<TOKEN>/getWebhookInfo"` —
`"url"` совпадает, `last_error_message` пуст.

Локальная разработка: `npx wrangler dev` (секреты берутся из `.dev.vars`,
он в .gitignore и в git не попадает).

## Логи

```bash
npx wrangler tail
```
