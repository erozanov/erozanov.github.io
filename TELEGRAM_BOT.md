# Telegram-бот для публикации моментов

Автоматическая публикация фото и заметок из Telegram прямо на сайт.

## Итоговый флоу

```
Telegram (ты)
    │  /city Санья → контекст сохранён
    │  фото + подпись → публикация
    ▼
Cloudflare Worker (бот)
    ├─ сохраняет контекст в Cloudflare KV
    ├─ скачивает медиа с серверов Telegram
    ├─ сжимает фото (sharp/wasm) и кладёт в R2
    └─ создаёт moment.md через GitHub Contents API
                │
        GitHub Actions (уже есть)
                │
        astro build + pagefind
                │
        erozanov.github.io ← ~1 мин
```

## Роли: что делает бот, а что — скрипт

| Задача | Инструмент |
|--------|-----------|
| **Создать поездку** (города, карта, обложка) | `publish-note.mjs` из Obsidian (`mode: trip`) |
| **Добавить момент** (фото + текст) | Telegram-бот ← _это и есть главная цель бота_ |

Поездку создаёшь один раз перед поездкой. После этого все фото и заметки
прямо в дороге — через Telegram.

## Команды бота

| Команда | Что делает |
|---------|-----------|
| `/trip china` | Устанавливает активную поездку |
| `/city Санья` | Устанавливает активный город (проверяет, что он есть в поездке) |
| `/status` | Показывает текущий контекст (trip + city) |
| `/trips` | Список доступных поездок с городами |
| `/draft` | Следующая публикация создаётся со `status: draft` (без деплоя) |
| `/cancel` | Отменяет накопленный черновик альбома |

**Обычное сообщение (не команда):**
- Фото/видео + подпись → момент на сайте
- Альбом (media group) → все фото попадают в один момент
- Хэштеги в подписи → теги момента (`#море #утро`)
- `⭐` перед подписью → первое фото получает `best: true`

## Шаг 1 — Создать Telegram-бота

1. Открыть [@BotFather](https://t.me/BotFather) в Telegram
2. `/newbot` → задать имя и username (например `sledom_blog_bot`)
3. Сохранить **Bot Token** (`123456:ABC-DEF...`)
4. `/setcommands` → вставить список команд:
   ```
   trip - Выбрать поездку (напр. /trip china)
   city - Выбрать город (напр. /city Санья)
   status - Текущий контекст
   trips - Список поездок
   draft - Следующий пост в черновик
   cancel - Отменить черновик
   ```
5. Узнать свой Telegram User ID (через [@userinfobot](https://t.me/userinfobot)) —
   нужен чтобы бот принимал сообщения только от тебя.

## Шаг 2 — Настроить Cloudflare

### 2a. KV namespace (хранит контекст сессии)
```bash
npx wrangler kv namespace create "BLOG_KV"
# Запомнить id из вывода
```

### 2b. R2 bucket (уже должен быть — `sledom-media`)
Если нет:
```bash
npx wrangler r2 bucket create sledom-media
```

### 2c. GitHub Personal Access Token
1. GitHub → Settings → Developer settings → Personal access tokens → Fine-grained tokens
2. Репозиторий: `erozanov/travel_blog`
3. Permissions:
   - **Contents** → Read and Write (для создания файлов моментов и медиа)
   - **Actions** → Read (опционально, для проверки статуса деплоя)
4. Сохранить токен.

## Шаг 3 — Создать Worker

### Структура папки
```
bot/
├── src/
│   ├── index.ts         ← точка входа, роутер Telegram updates
│   ├── context.ts       ← работа с KV: get/set trip, city
│   ├── commands.ts      ← обработчики /trip, /city, /status, /trips
│   ├── media.ts         ← скачивание с TG, загрузка в R2, сжатие
│   ├── publish.ts       ← сборка moment.md + GitHub Contents API
│   ├── album.ts         ← буферизация media_group (несколько фото)
│   └── trips.ts         ← список поездок читается из GitHub (src/content/trips)
├── wrangler.toml
└── package.json
```

### wrangler.toml
```toml
name = "sledom-blog-bot"
main = "src/index.ts"
compatibility_date = "2024-09-23"

[[kv_namespaces]]
binding = "BLOG_KV"
id = "ТВОЙ_KV_ID"

[[r2_buckets]]
binding = "MEDIA_BUCKET"
bucket_name = "sledom-media"

[vars]
GITHUB_OWNER = "erozanov"
GITHUB_REPO  = "travel_blog"
GITHUB_BRANCH = "main"
```

### Секреты (не в wrangler.toml)
```bash
npx wrangler secret put TELEGRAM_BOT_TOKEN
npx wrangler secret put TELEGRAM_ALLOWED_USER_ID   # твой числовой ID
npx wrangler secret put GITHUB_TOKEN
```

## Шаг 4 — Код Worker

### src/index.ts — точка входа
```typescript
export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    // Проверяем секрет в URL (/webhook/SECRET)
    const url = new URL(request.url);
    if (!url.pathname.startsWith('/webhook/')) return new Response('Not found', { status: 404 });

    const update = await request.json() as TelegramUpdate;
    await handleUpdate(update, env);
    return new Response('OK');
  }
}
```

**Важно:** Webhook URL содержит секрет в пути (`/webhook/RANDOM_SECRET`) —
это защита от посторонних запросов.

### Логика обработки альбомов (media_group)

Telegram присылает фото из альбома несколькими отдельными update'ами с одинаковым
`media_group_id`. Worker должен их склеить:

1. Первое фото: создать запись в KV с `media_group_id` → `[]`
2. Каждое следующее: добавить в список
3. Через 3 сек после последнего фото (через Durable Object alarm) → опубликовать

> **Рекомендация для старта:** каждое сообщение (фото/видео + подпись) = один момент.
> Альбомы можно добавить позже через Durable Objects.

### src/publish.ts — создание момента через GitHub API

```typescript
async function publishMoment(params: MomentParams, env: Env) {
  // 1. Скачать медиа с Telegram и залить в R2
  const mediaItems = await downloadAndUploadMedia(params.media, env);

  // 2. Сформировать slug и frontmatter
  const dateStr = new Date().toISOString().slice(0, 10);  // YYYY-MM-DD
  const momentId = await uniqueMomentId(params.tripId, dateStr, env);

  const content = buildMomentFile({
    title: params.title,
    tripId: params.tripId,
    city: params.city,
    citySlug: params.citySlug,
    date: dateStr,
    tags: params.tags,
    media: mediaItems,
    body: params.body,
  });

  // 3. Создать файл через GitHub Contents API
  await createGitHubFile({
    path: `src/content/moments/${momentId}.md`,
    content,
    message: `Момент: ${params.title} (${momentId})`,
    env,
  });

  // 4. GitHub Actions запускается автоматически на push → деплой ~1 мин
  return `https://erozanov.github.io/trips/${params.tripId}/#${momentId}`;
}
```

### GitHub Contents API — создание файла
```typescript
async function createGitHubFile({ path, content, message, env }) {
  const encoded = btoa(unescape(encodeURIComponent(content))); // base64 UTF-8
  const response = await fetch(
    `https://api.github.com/repos/${env.GITHUB_OWNER}/${env.GITHUB_REPO}/contents/${path}`,
    {
      method: 'PUT',
      headers: {
        Authorization: `Bearer ${env.GITHUB_TOKEN}`,
        'Content-Type': 'application/json',
        'User-Agent': 'sledom-blog-bot',
      },
      body: JSON.stringify({ message, content: encoded, branch: env.GITHUB_BRANCH }),
    }
  );
  if (!response.ok) throw new Error(await response.text());
}
```

### src/media.ts — загрузка медиа

```typescript
async function downloadAndUploadMedia(fileId: string, key: string, env: Env) {
  // 1. Получить download URL от Telegram
  const fileInfo = await telegramApi('getFile', { file_id: fileId }, env);
  const url = `https://api.telegram.org/file/bot${env.TELEGRAM_BOT_TOKEN}/${fileInfo.file_path}`;

  // 2. Скачать
  const response = await fetch(url);
  const buffer = await response.arrayBuffer();

  // 3. Залить в R2
  await env.MEDIA_BUCKET.put(key, buffer, {
    httpMetadata: { contentType: response.headers.get('content-type') ?? 'image/jpeg' }
  });
}
```

> **Сжатие фото в Worker:** библиотека `@cf-wasm/photon` позволяет ресайзить до 2000px
> прямо в Worker через WebAssembly — без внешнего сервиса.

## Шаг 5 — Деплой Worker и настройка Webhook

```bash
cd bot
npm install
npx wrangler deploy

# Зарегистрировать webhook в Telegram
# (подставить токен и случайный секрет в URL)
curl "https://api.telegram.org/bot<TOKEN>/setWebhook" \
  -d "url=https://sledom-blog-bot.ТВОЙ_SUBDOMAIN.workers.dev/webhook/RANDOM_SECRET"
```

## Шаг 6 — GitHub Actions

В существующий `.github/workflows/deploy.yml` ничего менять не нужно:
пуш в `main` уже тригерит деплой. Worker создаёт файл через GitHub API →
GitHub регистрирует пуш → Actions запускается автоматически.

## Шаг 7 — UX и обработка ошибок

Worker всегда отвечает в Telegram:

| Ситуация | Сообщение |
|----------|-----------|
| Нет активного города | ⚠️ Установи город: /city Санья |
| Город не найден в поездке | ⚠️ Город «Анталья» не найден в china. Доступны: Санья, Шэньчжэнь... |
| Медиа загружается | ⏳ Загружаю медиа... |
| Файл создан, деплой начат | ✅ Опубликовано! Деплой ~1 мин.\nhttps://erozanov.github.io/trips/china/#china-20261013 |
| Ошибка GitHub API | ❌ Не удалось создать файл. Проверь GitHub Token. |

## Порядок реализации (рекомендуемый)

| Этап | Что делаем | Время |
|------|-----------|-------|
| **MVP** | Worker принимает одно фото + текст → создаёт момент без сжатия | ~2 ч |
| **Контекст** | Команды /trip, /city, /status с KV + валидация городов | ~1 ч |
| **Сжатие** | @cf-wasm/photon для ресайза до 2000px | ~1 ч |
| **Альбомы** | Durable Object для буферизации media_group | ~2 ч |
| **Теги** | Парсинг #хэштегов из подписи | ~30 мин |
| **Дата** | Команда /date YYYY-MM-DD для явного указания | ~30 мин |

## Переменные окружения — итоговый список

| Переменная | Где задаётся | Описание |
|-----------|-------------|----------|
| `TELEGRAM_BOT_TOKEN` | wrangler secret | Токен от BotFather |
| `TELEGRAM_ALLOWED_USER_ID` | wrangler secret | Твой числовой Telegram ID |
| `GITHUB_TOKEN` | wrangler secret | Fine-grained PAT |
| `GITHUB_OWNER` | wrangler.toml vars | `erozanov` |
| `GITHUB_REPO` | wrangler.toml vars | `travel_blog` |
| `GITHUB_BRANCH` | wrangler.toml vars | `main` |
| `BLOG_KV` | wrangler.toml kv_namespaces | Cloudflare KV namespace |
| `MEDIA_BUCKET` | wrangler.toml r2_buckets | R2 bucket `sledom-media` |

## Нюансы и подводные камни

### Список поездок и городов
Worker должен знать доступные поездки и их города для валидации `/city`.
Лучший вариант: читать `src/content/trips/*.md` через GitHub Contents API и
кешировать результат в KV с TTL 1 час.

### Дата момента
По умолчанию берётся текущая дата UTC. Поскольку ты в Дубае (UTC+4), публикация
в 23:30 по местному = следующий день по UTC. Добавить команду `/date 2026-10-13`
для явного указания даты.

### Telegram ограничения
- Максимальный размер файла через Bot API: **20 МБ** (фото) / **50 МБ** (документ)
- Для видео > 50 МБ придётся просить сжимать заранее:
  `ffmpeg -i in.mov -vf scale=1280:-2 -crf 28 out.mp4`

### Безопасность
- Проверять `from.id` в каждом update — принимать только от `TELEGRAM_ALLOWED_USER_ID`
- Секрет в webhook URL — защита от случайных запросов
- GitHub Token с минимальными правами (только Contents на один репозиторий)

## Файлы, которые не нужно менять

Вся существующая часть блога остаётся нетронутой:
- `src/content/` — Worker только добавляет файлы через GitHub API
- `scripts/publish-note.mjs` — по-прежнему работает для публикации из Obsidian
- `.github/workflows/deploy.yml` — не меняется
- `astro.config.mjs`, компоненты, стили — не трогаем
