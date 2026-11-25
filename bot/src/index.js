/**
 * Telegram-бот блога «Следом» (Cloudflare Worker).
 *
 * Флоу: /trip <id> → /city <название> → фото/видео/текст с подписью →
 * медиа коммитятся в public/media/<trip>/<citySlug>/, заметка — в
 * src/content/moments/. Push в main триггерит GitHub Actions → деплой.
 *
 * Роли (KV ключ `roles`): admin — всё; editor — публикация и правки;
 * guest — посты через подтверждение админа. Если ключа нет — владелец
 * TELEGRAM_ALLOWED_USER_ID считается admin.
 *
 * История публикаций (KV `history:<chatId>`, последние 20) — для /delete
 * и редактирования ответом на сообщение бота.
 */

const GH_API = 'https://api.github.com';
const MAX_TG_FILE = 20 * 1024 * 1024; // лимит скачивания Bot API

// ─── Точка входа ─────────────────────────────────────────────────────────────

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    if (request.method !== 'POST' || url.pathname !== `/webhook/${env.WEBHOOK_SECRET}`) {
      return new Response('Not found', { status: 404 });
    }
    const update = await request.json();
    ctx.waitUntil(handleUpdate(update, env).catch((err) => console.error('handleUpdate:', err)));
    return new Response('OK');
  },
};

// ─── Роутинг обновлений ──────────────────────────────────────────────────────

async function handleUpdate(update, env) {
  if (update.callback_query) {
    await handleCallback(update.callback_query, env);
    return;
  }

  const msg = update.message ?? update.channel_post;
  if (!msg || !msg.from) return;

  const roles = await getRoles(env);
  const role = roles[String(msg.from.id)];
  if (!role) {
    await send(env, msg.chat.id, '⛔ Этот бот приватный.');
    return;
  }

  const text = (msg.text ?? msg.caption ?? '').trim();

  if (text.startsWith('/')) {
    await handleCommand(env, msg, text, role);
    return;
  }

  // Редактирование: ответ на сообщение бота о публикации
  if (msg.reply_to_message && role !== 'guest') {
    const entry = await findHistoryByBotMessage(env, msg.chat.id, msg.reply_to_message.message_id);
    if (entry) {
      await editMoment(env, msg.chat.id, entry, text);
      return;
    }
    if (msg.reply_to_message.from?.is_bot) {
      await send(env, msg.chat.id, 'Это сообщение бота не связано с постом (старое?). Отправьте текст без reply — создам новый пост.');
      return;
    }
  }

  if (role === 'guest') {
    await submitForApproval(env, msg, text);
    return;
  }

  if (msg.media_group_id) {
    await bufferAlbumItem(env, msg, text);
    return;
  }

  const item = extractMedia(msg);
  await publish(env, msg.chat.id, {
    items: item ? [item] : [],
    caption: text,
    messageDate: msg.date,
  });
}

// ─── Роли ────────────────────────────────────────────────────────────────────

async function getRoles(env) {
  const roles = await env.BLOG_KV.get('roles', 'json');
  if (roles && Object.keys(roles).length > 0) return roles;
  return { [String(env.TELEGRAM_ALLOWED_USER_ID)]: 'admin' };
}

async function saveRoles(env, roles) {
  await env.BLOG_KV.put('roles', JSON.stringify(roles));
}

// ─── Команды ─────────────────────────────────────────────────────────────────

async function handleCommand(env, msg, text, role) {
  const chatId = msg.chat.id;
  const [rawCmd, ...rest] = text.split(/\s+/);
  const cmd = rawCmd.slice(1).split('@')[0].toLowerCase();
  const arg = rest.join(' ').trim();

  if (role === 'guest' && !['help', 'status'].includes(cmd)) {
    await send(env, chatId, 'Ваша роль — guest: пришлите фото/текст, админ подтвердит публикацию.');
    return;
  }

  switch (cmd) {
    case 'start':
    case 'help': {
      let help = 'Я публикую моменты в блог «Следом».\n\n'
        + '1. /trip <id> — выбрать поездку\n'
        + '2. /city <название> — выбрать город\n'
        + '3. Отправь фото/видео с подписью — опубликую.\n\n'
        + 'Первая строка подписи — заголовок, остальное — текст.\n'
        + 'Хэштеги → теги. ⭐ в начале — лучший кадр.\n'
        + '/status · /trips · /date ГГГГ-ММ-ДД\n'
        + '/delete — удалить последний пост\n'
        + 'Ответь на моё «✅ Опубликовано» новым текстом — обновлю пост.';
      if (role === 'admin') help += '\n\nАдмин: /role — роли пользователей.';
      await send(env, chatId, help);
      return;
    }

    case 'trip': {
      if (!arg) { await send(env, chatId, 'Укажите id поездки: /trip china'); return; }
      const trips = await getTrips(env);
      const trip = trips.find((t) => t.id === arg.toLowerCase());
      if (!trip) {
        await send(env, chatId, `⚠️ Поездка «${arg}» не найдена. Доступны:\n`
          + trips.map((t) => `• ${t.id} — ${t.title}`).join('\n'));
        return;
      }
      const ctx = await getCtx(env, chatId);
      ctx.trip = trip.id;
      ctx.tripTitle = trip.title;
      ctx.city = null;
      await setCtx(env, chatId, ctx);
      await send(env, chatId, `✅ Поездка: ${trip.title}\nТеперь выберите город: /city ${trip.cities[0]?.name ?? '…'}`);
      return;
    }

    case 'city': {
      if (!arg) { await send(env, chatId, 'Укажите город: /city Санья'); return; }
      const ctx = await getCtx(env, chatId);
      if (!ctx.trip) { await send(env, chatId, '⚠️ Сначала выберите поездку: /trip <id>'); return; }
      const trips = await getTrips(env);
      const trip = trips.find((t) => t.id === ctx.trip);
      const city = trip?.cities.find(
        (c) => c.name.toLowerCase() === arg.toLowerCase() || c.slug === arg.toLowerCase(),
      );
      if (!city) {
        await send(env, chatId, `⚠️ Город «${arg}» не найден в «${ctx.trip}». Доступны:\n`
          + (trip?.cities.map((c) => `• ${c.name}`).join('\n') ?? '—'));
        return;
      }
      ctx.city = city;
      await setCtx(env, chatId, ctx);
      await send(env, chatId, `✅ Город: ${city.name}. Отправляйте фото, видео или текст с подписью!`);
      return;
    }

    case 'status': {
      const ctx = await getCtx(env, chatId);
      await send(env, chatId,
        `Роль: ${role}\n`
        + `Поездка: ${ctx.trip ? `${ctx.tripTitle} (${ctx.trip})` : '—'}\n`
        + `Город: ${ctx.city ? ctx.city.name : '—'}\n`
        + `Дата поста: ${ctx.dateOverride ?? 'сегодня'}`);
      return;
    }

    case 'trips': {
      const trips = await getTrips(env);
      await send(env, chatId, trips.map((t) =>
        `• ${t.id} — ${t.title}\n  ${t.cities.map((c) => c.name).join(', ')}`).join('\n'));
      return;
    }

    case 'date': {
      const ctx = await getCtx(env, chatId);
      if (arg === 'сегодня') {
        delete ctx.dateOverride;
        await setCtx(env, chatId, ctx);
        await send(env, chatId, '✅ Дата снова — сегодняшняя.');
        return;
      }
      if (!/^\d{4}-\d{2}-\d{2}$/.test(arg)) {
        await send(env, chatId, 'Формат: /date 2026-10-13 (или /date сегодня — сбросить)');
        return;
      }
      ctx.dateOverride = arg;
      await setCtx(env, chatId, ctx);
      await send(env, chatId, `✅ Дата следующих постов: ${arg}`);
      return;
    }

    case 'delete': {
      const history = await getHistory(env, chatId);
      if (history.length === 0) { await send(env, chatId, 'Нечего удалять — история пуста.'); return; }
      const n = Math.max(1, parseInt(arg, 10) || 1);
      const entry = history[history.length - n];
      if (!entry) { await send(env, chatId, `Нет поста №${n} с конца (в истории ${history.length}).`); return; }
      try {
        await ghDeleteFile(env, `src/content/moments/${entry.momentId}.md`, `Удалён момент: ${entry.title} (${entry.momentId})`);
        for (const key of entry.mediaKeys ?? []) {
          await ghDeleteFile(env, `public/media/${key}`, `Удалено медиа: ${key}`).catch(() => {});
        }
        history.splice(history.length - n, 1);
        await saveHistory(env, chatId, history);
        await send(env, chatId, `🗑 Удалено: «${entry.title}» (${entry.momentId}). Деплой ~1 мин.`);
      } catch (err) {
        await send(env, chatId, `❌ Не удалось удалить: ${String(err.message ?? err).slice(0, 200)}`);
      }
      return;
    }

    case 'role': {
      if (role !== 'admin') { await send(env, chatId, 'Команда только для admin.'); return; }
      const roles = await getRoles(env);
      const parts = arg.split(/\s+/).filter(Boolean);
      if (parts.length === 0) {
        await send(env, chatId, 'Роли:\n' + Object.entries(roles).map(([id, r]) => `• ${id} — ${r}`).join('\n')
          + '\n\n/role add <id> <admin|editor|guest>\n/role remove <id>');
        return;
      }
      if (parts[0] === 'add' && parts.length === 3 && ['admin', 'editor', 'guest'].includes(parts[2])) {
        roles[parts[1]] = parts[2];
        await saveRoles(env, roles);
        await send(env, chatId, `✅ ${parts[1]} → ${parts[2]}`);
        return;
      }
      if (parts[0] === 'remove' && parts.length === 2) {
        if (parts[1] === String(env.TELEGRAM_ALLOWED_USER_ID)) {
          await send(env, chatId, 'Себя (владельца) удалить нельзя.');
          return;
        }
        delete roles[parts[1]];
        await saveRoles(env, roles);
        await send(env, chatId, `✅ ${parts[1]} удалён из ролей`);
        return;
      }
      await send(env, chatId, 'Формат: /role add <id> <admin|editor|guest> или /role remove <id>');
      return;
    }

    default:
      await send(env, chatId, 'Не знаю такой команды. /help — список.');
  }
}

// ─── Модерация (guest → admin) ───────────────────────────────────────────────

async function submitForApproval(env, msg, text) {
  const item = extractMedia(msg);
  if (!item && !text) return;
  const pendingId = crypto.randomUUID().slice(0, 8);
  await env.BLOG_KV.put(`pending:${pendingId}`, JSON.stringify({
    items: item ? [item] : [],
    caption: text,
    messageDate: msg.date,
    fromName: msg.from.first_name ?? 'гость',
    chatId: msg.chat.id,
  }), { expirationTtl: 86400 });

  const adminId = env.TELEGRAM_ALLOWED_USER_ID;
  await tg(env, 'sendMessage', {
    chat_id: adminId,
    text: `📨 На модерацию от ${msg.from.first_name ?? 'гостя'}:\n${text || '(без подписи)'}${item ? `\n[${item.kind}]` : ''}`,
    reply_markup: {
      inline_keyboard: [[
        { text: '✅ Опубликовать', callback_data: `ok:${pendingId}` },
        { text: '❌ Отклонить', callback_data: `no:${pendingId}` },
      ]],
    },
  });
  await send(env, msg.chat.id, '📨 Отправлено на модерацию — админ подтвердит, и пост появится на сайте.');
}

async function handleCallback(query, env) {
  const roles = await getRoles(env);
  if (roles[String(query.from.id)] !== 'admin') {
    await tg(env, 'answerCallbackQuery', { callback_query_id: query.id, text: 'Только для admin' });
    return;
  }
  const [action, pendingId] = (query.data ?? '').split(':');
  const pending = await env.BLOG_KV.get(`pending:${pendingId}`, 'json');
  await tg(env, 'answerCallbackQuery', { callback_query_id: query.id });

  if (!pending) {
    await tg(env, 'editMessageText', { chat_id: query.message.chat.id, message_id: query.message.message_id, text: '⌛ Заявка протухла (24 ч).' });
    return;
  }
  await env.BLOG_KV.delete(`pending:${pendingId}`);

  if (action === 'ok') {
    await tg(env, 'editMessageText', { chat_id: query.message.chat.id, message_id: query.message.message_id, text: `⏳ Публикую заявку ${pendingId}…` });
    await publish(env, pending.chatId, pending);
  } else {
    await tg(env, 'editMessageText', { chat_id: query.message.chat.id, message_id: query.message.message_id, text: `❌ Заявка ${pendingId} отклонена.` });
    await send(env, pending.chatId, '❌ Пост не прошёл модерацию.');
  }
}

// ─── Публикация ──────────────────────────────────────────────────────────────

async function publish(env, chatId, { items, caption, messageDate }) {
  const ctx = await getCtx(env, chatId);
  if (!ctx.trip) { await send(env, chatId, '⚠️ Установите поездку: /trip <id>'); return; }
  if (!ctx.city) { await send(env, chatId, '⚠️ Установите город: /city <название>'); return; }

  const { tags, best, title, body } = parseCaption(caption, messageDate);
  const date = ctx.dateOverride ?? formatDate(messageDate, env);
  const media = [];

  try {
    // ID момента заранее — имена медиа строим от него (без конфликтов).
    const momentId = await uniqueMomentId(env, ctx.trip, date);

    if (items.length > 0) await send(env, chatId, '⏳ Загружаю медиа…');
    for (let i = 0; i < items.length; i++) {
      const item = items[i];
      const file = await tg(env, 'getFile', { file_id: item.fileId });
      if (file.file_size && file.file_size > MAX_TG_FILE) {
        throw new Error(`Файл больше 20 МБ (${(file.file_size / 1048576).toFixed(1)} МБ). Сожмите заранее.`);
      }
      const buffer = await downloadTgFile(env, file.file_path);
      const ext = item.kind === 'video' ? extFromPath(file.file_path, '.mp4') : '.jpg';
      const key = `${ctx.trip}/${ctx.city.slug}/${momentId}-${String(i + 1).padStart(2, '0')}${ext}`;
      await ghPutFile(env, `public/media/${key}`, bufToBase64(buffer), `Медиа: ${key}`);
      media.push({ type: item.kind, src: key, alt: title, best: best && i === 0 });
    }

    const content = buildMoment({
      title, tripId: ctx.trip, cityName: ctx.city.name, citySlug: ctx.city.slug,
      date, tags, media, body,
    });
    await ghPutFile(env, `src/content/moments/${momentId}.md`,
      bufToBase64(new TextEncoder().encode(content).buffer), `Момент: ${title} (${momentId})`);

    const url = `${env.SITE_URL}/trips/${ctx.trip}/#${momentId}`;
    const sent = await send(env, chatId, `✅ Опубликовано! Деплой ~1 мин.\n${url}\n\nОтветьте на это сообщение новым текстом — обновлю пост. /delete — удалить.`);

    await pushHistory(env, chatId, {
      momentId,
      tripId: ctx.trip,
      cityName: ctx.city.name,
      citySlug: ctx.city.slug,
      date,
      title,
      mediaKeys: media.map((m) => m.src),
      botMessageId: sent?.message_id,
      ts: Date.now(),
    });
  } catch (err) {
    console.error(err);
    await send(env, chatId, `❌ Не удалось опубликовать: ${String(err.message ?? err).slice(0, 200)}`);
  }
}

function buildMoment({ title, tripId, cityName, citySlug, date, tags, media, body }) {
  const q = (s) => `"${String(s).replaceAll('"', "'")}"`;
  const mediaYaml = media.length === 0
    ? 'media: []'
    : 'media:\n' + media.map((m) => {
        let s = `  - type: ${m.type}\n    src: ${q(m.src)}\n    alt: ${q(m.alt)}`;
        if (m.best) s += '\n    best: true';
        return s;
      }).join('\n');
  return `---\ntitle: ${q(title)}\ntrip: ${tripId}\ncity: ${q(cityName)}\ncitySlug: ${citySlug}\ndate: ${date}\ntags: [${tags.join(', ')}]\n${mediaYaml}\n---\n\n${body}\n`;
}

// ─── Редактирование ──────────────────────────────────────────────────────────

async function editMoment(env, chatId, entry, newText) {
  if (!newText) { await send(env, chatId, 'Пришлите новый текст ответом на сообщение о посте.'); return; }
  try {
    const file = await ghGetJson(env, `src/content/moments/${entry.momentId}.md`);
    if (!file) { await send(env, chatId, 'Файл поста не найден — возможно, уже удалён.'); return; }

    const { tags, best, title, body } = parseCaption(newText, null);
    const current = buildMoment({
      title, tripId: entry.tripId, cityName: entry.cityName, citySlug: entry.citySlug,
      date: entry.date, tags,
      media: (entry.mediaKeys ?? []).map((src, i) => ({ type: src.endsWith('.mp4') ? 'video' : 'photo', src, alt: title, best: best && i === 0 })),
      body,
    });
    await ghPutFile(env, `src/content/moments/${entry.momentId}.md`,
      bufToBase64(new TextEncoder().encode(current).buffer),
      `Правка момента: ${title} (${entry.momentId})`, file.sha);

    entry.title = title;
    await pushHistoryEntry(env, chatId, entry);
    await send(env, chatId, `✏️ Обновлено: «${title}». Деплой ~1 мин.`);
  } catch (err) {
    await send(env, chatId, `❌ Не удалось обновить: ${String(err.message ?? err).slice(0, 200)}`);
  }
}

// ─── История публикаций (KV) ─────────────────────────────────────────────────

async function getHistory(env, chatId) {
  return (await env.BLOG_KV.get(`history:${chatId}`, 'json')) ?? [];
}

async function saveHistory(env, chatId, history) {
  await env.BLOG_KV.put(`history:${chatId}`, JSON.stringify(history.slice(-20)));
}

async function pushHistory(env, chatId, entry) {
  const history = await getHistory(env, chatId);
  history.push(entry);
  await saveHistory(env, chatId, history);
}

async function pushHistoryEntry(env, chatId, entry) {
  const history = await getHistory(env, chatId);
  const idx = history.findIndex((h) => h.momentId === entry.momentId);
  if (idx >= 0) history[idx] = entry;
  await saveHistory(env, chatId, history);
}

async function findHistoryByBotMessage(env, chatId, botMessageId) {
  const history = await getHistory(env, chatId);
  return history.find((h) => h.botMessageId === botMessageId) ?? null;
}

// ─── Альбомы ─────────────────────────────────────────────────────────────────

async function bufferAlbumItem(env, msg, caption) {
  const item = extractMedia(msg);
  if (!item) return;
  const key = `album:${msg.media_group_id}`;
  const state = (await env.BLOG_KV.get(key, 'json')) ?? { items: [], captions: [], gen: 0, chatId: msg.chat.id, date: msg.date };
  state.items.push(item);
  if (caption) state.captions.push(caption);
  state.gen += 1;
  const myGen = state.gen;
  await env.BLOG_KV.put(key, JSON.stringify(state), { expirationTtl: 3600 });

  (async () => {
    await sleep(5000);
    const fresh = await env.BLOG_KV.get(key, 'json');
    if (!fresh || fresh.gen !== myGen) return;
    await env.BLOG_KV.delete(key);
    await publish(env, fresh.chatId, {
      items: fresh.items,
      caption: fresh.captions[0] ?? '',
      messageDate: fresh.date,
    });
  })().catch((err) => console.error('album:', err));
}

function extractMedia(msg) {
  if (msg.photo?.length) {
    const largest = msg.photo[msg.photo.length - 1];
    return { kind: 'photo', fileId: largest.file_id };
  }
  if (msg.video) return { kind: 'video', fileId: msg.video.file_id };
  if (msg.document && /\.(mp4|mov|webm|jpe?g|png)$/i.test(msg.document.file_name ?? '')) {
    return { kind: msg.document.mime_type?.startsWith('video') ? 'video' : 'photo', fileId: msg.document.file_id };
  }
  return null;
}

// ─── Разбор подписи ──────────────────────────────────────────────────────────

function parseCaption(caption, messageDate) {
  let text = caption;
  const best = /^⭐/.test(text);
  if (best) text = text.slice(1).trim();

  const tags = [...text.matchAll(/#([\p{L}\p{N}_-]+)/gu)].map((m) => m[1].toLowerCase());
  text = text.replace(/#[\p{L}\p{N}_-]+/gu, '').replace(/[ \t]+\n/g, '\n').trim();

  const firstLine = text.split('\n')[0]?.trim() ?? '';
  const title = firstLine
    ? firstLine.slice(0, 60)
    : `Момент ${messageDate ? formatDate(messageDate, { TZ_OFFSET_HOURS: '4' }) : 'без даты'}`;
  const body = text.split('\n').slice(1).join('\n').trim() || text;
  return { tags, best, title, body: body === title ? '' : body };
}

// ─── GitHub ──────────────────────────────────────────────────────────────────

function ghHeaders(env) {
  return {
    Authorization: `Bearer ${env.GITHUB_TOKEN}`,
    'Content-Type': 'application/json',
    'User-Agent': 'sledom-blog-bot',
    Accept: 'application/vnd.github+json',
  };
}

async function ghPutFile(env, path, base64Content, message, sha = undefined) {
  const body = { message, content: base64Content, branch: env.GITHUB_BRANCH };
  if (sha) body.sha = sha;
  const res = await fetch(
    `${GH_API}/repos/${env.GITHUB_OWNER}/${env.GITHUB_REPO}/contents/${encodeURI(path)}`,
    { method: 'PUT', headers: ghHeaders(env), body: JSON.stringify(body) },
  );
  if (!res.ok) throw new Error(`GitHub ${res.status}: ${(await res.text()).slice(0, 150)}`);
}

async function ghDeleteFile(env, path, message) {
  const file = await ghGetJson(env, path);
  if (!file) return; // уже удалён
  const res = await fetch(
    `${GH_API}/repos/${env.GITHUB_OWNER}/${env.GITHUB_REPO}/contents/${encodeURI(path)}`,
    { method: 'DELETE', headers: ghHeaders(env), body: JSON.stringify({ message, sha: file.sha, branch: env.GITHUB_BRANCH }) },
  );
  if (!res.ok) throw new Error(`GitHub DELETE ${res.status}: ${(await res.text()).slice(0, 150)}`);
}

async function ghGetJson(env, path) {
  const res = await fetch(`${GH_API}/repos/${env.GITHUB_OWNER}/${env.GITHUB_REPO}/contents/${encodeURI(path)}?ref=${env.GITHUB_BRANCH}`, {
    headers: ghHeaders(env),
  });
  if (res.status === 404) return null;
  if (!res.ok) throw new Error(`GitHub ${res.status}`);
  return res.json();
}

async function uniqueMomentId(env, tripId, date) {
  const compact = date.replaceAll('-', '');
  for (let n = 1; n <= 20; n++) {
    const id = n === 1 ? `${tripId}-${compact}` : `${tripId}-${compact}-${n}`;
    const existing = await ghGetJson(env, `src/content/moments/${id}.md`);
    if (!existing) return id;
  }
  throw new Error('Не удалось подобрать id момента');
}

// Список поездок и городов — из репозитория, кэш в KV на 1 час
async function getTrips(env) {
  const cached = await env.BLOG_KV.get('trips-cache', 'json');
  if (cached) return cached;

  const files = await ghGetJson(env, 'src/content/trips');
  const trips = [];
  for (const file of files.filter((f) => f.name.endsWith('.md'))) {
    const res = await fetch(file.download_url);
    const md = await res.text();
    const title = md.match(/^title:\s*"(.+)"/m)?.[1] ?? file.name;
    const cities = [...md.matchAll(/- name:\s*"(.+?)"[\s\S]*?slug:\s*"(.+?)"/g)]
      .map((m) => ({ name: m[1], slug: m[2] }));
    trips.push({ id: file.name.replace(/\.md$/, ''), title, cities });
  }
  await env.BLOG_KV.put('trips-cache', JSON.stringify(trips), { expirationTtl: 3600 });
  return trips;
}

// ─── Telegram API ────────────────────────────────────────────────────────────

async function tg(env, method, payload) {
  const res = await fetch(`https://api.telegram.org/bot${env.TELEGRAM_BOT_TOKEN}/${method}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
  const data = await res.json();
  if (!data.ok) throw new Error(`Telegram ${method}: ${data.description}`);
  return data.result;
}

async function send(env, chatId, text) {
  return tg(env, 'sendMessage', { chat_id: chatId, text, disable_web_page_preview: true });
}

async function downloadTgFile(env, filePath) {
  const res = await fetch(`https://api.telegram.org/file/bot${env.TELEGRAM_BOT_TOKEN}/${filePath}`);
  if (!res.ok) throw new Error(`Скачивание файла: HTTP ${res.status}`);
  return res.arrayBuffer();
}

// ─── Контекст (KV) ───────────────────────────────────────────────────────────

async function getCtx(env, chatId) {
  return (await env.BLOG_KV.get(`ctx:${chatId}`, 'json')) ?? {};
}

async function setCtx(env, chatId, ctx) {
  await env.BLOG_KV.put(`ctx:${chatId}`, JSON.stringify(ctx));
}

// ─── Утилиты ─────────────────────────────────────────────────────────────────

function formatDate(unixSeconds, env) {
  const offset = Number(env.TZ_OFFSET_HOURS ?? 4);
  return new Date((unixSeconds + offset * 3600) * 1000).toISOString().slice(0, 10);
}

function extFromPath(filePath, fallback) {
  const m = filePath.match(/\.([a-z0-9]+)$/i);
  return m ? `.${m[1].toLowerCase()}` : fallback;
}

function bufToBase64(buf) {
  const bytes = new Uint8Array(buf);
  let binary = '';
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode.apply(null, bytes.subarray(i, i + chunk));
  }
  return btoa(binary);
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
