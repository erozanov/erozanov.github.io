#!/usr/bin/env node
/**
 * Публикация заметки из Obsidian в блог.
 *
 * Два режима — определяется полем «mode» во frontmatter:
 *
 *   mode: trip    — создать новую поездку (src/content/trips/<id>.md)
 *   mode: moment  — добавить заметку-момент  (src/content/moments/<id>.md)
 *   (если mode не указан — подразумевается moment)
 *
 * Использование:
 *   node scripts/publish-note.mjs <путь-к-заметке> [--no-push]
 *
 * Формат заметок описан в PUBLISHING.md.
 *
 * Окружение:
 *   PUBLISH_TARGET=r2  R2_BUCKET=sledom-media  CLOUDFLARE_API_TOKEN=...
 *     — медиа уходят в R2; в заметку пишется логический ключ без хоста.
 *   MEDIA_MIRROR_PATH=/Volumes/synology/sledom-media
 *     — зеркалировать медиа на внешний диск после публикации.
 *   MEDIA_BASE_URL  — хост медиа; задаётся при сборке сайта.
 */

import { copyFileSync, existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import path from 'node:path';

const repoRoot = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const config = {
  target: process.env.PUBLISH_TARGET ?? 'local', // local | r2
  r2Bucket: process.env.R2_BUCKET ?? 'sledom-media',
  localMediaDir: 'public/media',
  mirrorDir: 'media-mirror', // локальное веб-зеркало (сжатые до 2000px)
  originalsDir: 'media-originals', // локальный архив оригиналов (полное качество)
  nasTarget: process.env.MEDIA_NAS_PATH ?? process.env.MEDIA_MIRROR_PATH ?? '', // например /Volumes/synology/sledom-originals
  cloudBackupTarget: process.env.MEDIA_CLOUD_BACKUP ?? '', // например b2:my-backup или gdrive:TravelPhotos
  photosMaxSize: 2000,
};

const [, , notePathArg, ...flags] = process.argv;
const push = !flags.includes('--no-push');
if (!notePathArg) {
  console.error('Укажите путь к заметке: node scripts/publish-note.mjs <заметка> [--no-push]');
  process.exit(1);
}
const notePath = path.resolve(notePathArg);
const noteDir = path.dirname(notePath);

function fail(message) {
  console.error(`\n✗ ${message}`);
  process.exit(1);
}

// ─── Разбор заметки ───────────────────────────────────────────────────────────

const raw = readFileSync(notePath, 'utf8');
const match = raw.match(/^---\n([\s\S]*?)\n---\n([\s\S]*)$/);
if (!match) fail('В заметке нет frontmatter (--- … ---). См. PUBLISHING.md.');
const [, fmRaw, bodyRaw] = match;

const fields = {};
for (const line of fmRaw.split('\n')) {
  const m = line.match(/^([\w-]+):\s*(.*)$/);
  if (m) fields[m[1].trim()] = m[2].trim();
}

if (fields.status !== 'готово') fail(`status: «${fields.status}», а нужен «готово».`);

const mode = fields.mode ?? 'moment';
if (mode !== 'trip' && mode !== 'moment') fail(`mode: «${mode}» — допустимо только «trip» или «moment».`);

// ─── Общие утилиты медиа и бэкапов ─────────────────────────────────────────────

function saveOriginal(src, destKey) {
  const origDest = path.join(repoRoot, config.originalsDir, destKey);
  mkdirSync(path.dirname(origDest), { recursive: true });
  copyFileSync(src, origDest);
}

function mirrorWebFile(localPath, key) {
  const mirrorDest = path.join(repoRoot, config.mirrorDir, key);
  mkdirSync(path.dirname(mirrorDest), { recursive: true });
  copyFileSync(localPath, mirrorDest);
}

function processImage(srcFile, destKey) {
  const src = path.join(noteDir, srcFile);
  if (!existsSync(src)) fail(`Файл «${srcFile}» не найден рядом с заметкой (${noteDir}).`);

  // 1. Всегда сохраняем нетронутый оригинал в полный архив
  saveOriginal(src, destKey);

  // 2. Сжимаем до 2000px для веба
  if (config.target === 'r2') {
    const tmp = path.join('/tmp', `publish-${Date.now()}-${path.basename(srcFile)}`);
    execFileSync('sips', ['-Z', String(config.photosMaxSize), src, '--out', tmp], { stdio: 'ignore' });
    execFileSync(
      'npx',
      ['wrangler', 'r2', 'object', 'put', `${config.r2Bucket}/${destKey}`, '--file', tmp, '--remote'],
      { stdio: 'inherit' },
    );
    mirrorWebFile(tmp, destKey);
  } else {
    const dest = path.join(repoRoot, config.localMediaDir, destKey);
    mkdirSync(path.dirname(dest), { recursive: true });
    execFileSync('sips', ['-Z', String(config.photosMaxSize), src, '--out', dest], { stdio: 'ignore' });
    mirrorWebFile(dest, destKey);
  }
  console.log(`✓ ${srcFile} → ${destKey} (веб + оригинал сохранены)`);
  return destKey;
}

function processVideo(srcFile, destKey) {
  const src = path.join(noteDir, srcFile);
  if (!existsSync(src)) fail(`Файл «${srcFile}» не найден рядом с заметкой (${noteDir}).`);

  // 1. Сохраняем нетронутый оригинал
  saveOriginal(src, destKey);

  // 2. Видео для веб-раздачи
  if (config.target === 'r2') {
    const tmp = path.join('/tmp', `publish-${Date.now()}-${path.basename(srcFile)}`);
    copyFileSync(src, tmp);
    execFileSync(
      'npx',
      ['wrangler', 'r2', 'object', 'put', `${config.r2Bucket}/${destKey}`, '--file', tmp, '--remote'],
      { stdio: 'inherit' },
    );
    mirrorWebFile(tmp, destKey);
  } else {
    const dest = path.join(repoRoot, config.localMediaDir, destKey);
    mkdirSync(path.dirname(dest), { recursive: true });
    copyFileSync(src, dest);
    console.log(`! Видео «${srcFile}» скопировано без обработки. Для сжатия нужен ffmpeg.`);
    mirrorWebFile(dest, destKey);
  }
  console.log(`✓ ${srcFile} → ${destKey} (веб + оригинал сохранены)`);
  return destKey;
}

function syncBackups() {
  const origDir = path.join(repoRoot, config.originalsDir);
  if (!existsSync(origDir)) return;

  // 1. Синхронизация оригиналов на Synology NAS / домашнее хранилище
  if (config.nasTarget) {
    try {
      execFileSync(
        'rsync',
        ['-av', `${origDir}/`, config.nasTarget.replace(/\/?$/, '/')],
        { stdio: 'inherit' },
      );
      console.log(`✓ Оригиналы синхронизированы на NAS: ${config.nasTarget}`);
    } catch (err) {
      console.warn(`! Синхронизация на NAS (${config.nasTarget}) не удалась. Проверьте диск.`);
    }
  }

  // 2. Синхронизация оригиналов во второе облако (через rclone)
  if (config.cloudBackupTarget) {
    try {
      execFileSync(
        'rclone',
        ['sync', origDir, config.cloudBackupTarget],
        { stdio: 'inherit' },
      );
      console.log(`✓ Бэкап оригиналов во второе облако выполнен: ${config.cloudBackupTarget}`);
    } catch (err) {
      console.warn(`! Бэкап через rclone в ${config.cloudBackupTarget} не удался.`);
    }
  }
}

function gitPush(message) {
  if (!push) { console.log('(--no-push: коммит и пуш пропущены)'); return; }
  execFileSync('git', ['add', '-A'], { cwd: repoRoot, stdio: 'ignore' });
  execFileSync('git', ['commit', '-m', message], { cwd: repoRoot, stdio: 'ignore' });
  execFileSync('git', ['push'], { cwd: repoRoot, stdio: 'inherit' });
  console.log('✓ Запушено — деплой начнётся через минуту.');
}

// ─── Режим TRIP: создание новой поездки ──────────────────────────────────────

if (mode === 'trip') {
  // Обязательные поля
  for (const key of ['id', 'title', 'country', 'number', 'startDate', 'endDate', 'summary', 'cover', 'coverAlt']) {
    if (!fields[key]) fail(`Режим trip: в frontmatter нет поля «${key}». См. PUBLISHING.md.`);
  }
  for (const dateField of ['startDate', 'endDate']) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(fields[dateField]))
      fail(`${dateField}: «${fields[dateField]}» не в формате YYYY-MM-DD.`);
  }

  const tripId = fields.id.replace(/[^a-z0-9-]/gi, '-').toLowerCase();
  const tripFile = path.join(repoRoot, 'src/content/trips', `${tripId}.md`);
  const isUpdate = existsSync(tripFile);

  // Обложка → public/media/<tripId>-hero.<ext>
  const coverExt = path.extname(fields.cover) || '.jpg';
  const coverKey = `${tripId}-hero${coverExt}`;
  processImage(fields.cover, coverKey);

  // Города из блока ```cities ... ``` в теле заметки
  //
  // Формат каждой строки:
  //   Название | slug | lat | lng | tagline | image.jpg | alt текст
  //
  const citiesBlockMatch = bodyRaw.match(/```cities\n([\s\S]*?)```/);
  if (!citiesBlockMatch) {
    fail(
      'Не найден блок городов. Добавьте в заметку:\n\n```cities\n'
      + 'Токио | tokyo | 35.6762 | 139.6503 | Мегаполис, который никогда не спит | tokyo.jpg | Вид на Токио\n```',
    );
  }

  const cityLines = citiesBlockMatch[1]
    .split('\n')
    .map((l) => l.trim())
    .filter(Boolean);

  if (cityLines.length === 0) fail('Блок ```cities``` пустой — добавьте хотя бы один город.');

  const cities = cityLines.map((line, idx) => {
    const parts = line.split('|').map((p) => p.trim());
    if (parts.length < 7) {
      fail(
        `Строка города ${idx + 1} неверного формата (нужно 7 полей через |):\n  ${line}\n`
        + 'Ожидается: Название | slug | lat | lng | tagline | image.jpg | alt',
      );
    }
    const [name, slug, latStr, lngStr, tagline, imageFile, imageAlt] = parts;
    const lat = parseFloat(latStr);
    const lng = parseFloat(lngStr);
    if (isNaN(lat) || isNaN(lng)) fail(`Город «${name}»: координаты не распознаны («${latStr}», «${lngStr}»).`);

    // Изображение города → public/media/<tripId>-<slug>.<ext>
    const imgExt = path.extname(imageFile) || '.jpg';
    const imageKey = `${tripId}-${slug}${imgExt}`;
    processImage(imageFile, imageKey);

    return { name, slug, tagline, imageKey, imageAlt: imageAlt || '', lat, lng };
  });

  // Тело заметки без блока городов — станет описанием поездки
  const description = bodyRaw
    .replace(/```cities[\s\S]*?```/g, '')
    .replace(/!?\[\[[^\]]*\]\]/g, '') // убираем Obsidian-embeds
    .trim();

  // Формируем trips/<tripId>.md
  const citiesYaml = cities
    .map(
      (c) =>
        `  - name: "${c.name}"\n`
        + `    slug: "${c.slug}"\n`
        + `    tagline: "${c.tagline.replaceAll('"', "'")}"\n`
        + `    image: "/${config.localMediaDir}/${c.imageKey}"\n`
        + `    imageAlt: "${c.imageAlt.replaceAll('"', "'")}"\n`
        + `    coordinates: { lat: ${c.lat}, lng: ${c.lng} }`,
    )
    .join('\n');

  const featured = fields.featured === 'true' ? 'true' : 'false';
  const tripContent =
    `---\n`
    + `title: "${fields.title.replaceAll('"', "'")}"\n`
    + `country: "${fields.country.replaceAll('"', "'")}"\n`
    + `number: "${fields.number}"\n`
    + `startDate: ${fields.startDate}\n`
    + `endDate: ${fields.endDate}\n`
    + `summary: "${fields.summary.replaceAll('"', "'")}"\n`
    + `cover: "/${config.localMediaDir}/${coverKey}"\n`
    + `coverAlt: "${fields.coverAlt.replaceAll('"', "'")}"\n`
    + `featured: ${featured}\n`
    + `status: published\n`
    + `cities:\n${citiesYaml}\n`
    + `---\n\n`
    + description
    + '\n';

  writeFileSync(tripFile, tripContent);
  console.log(`✓ ${isUpdate ? 'Обновлена' : 'Создана'} поездка: src/content/trips/${tripId}.md`);

  syncBackups();
  gitPush(`${isUpdate ? 'Обновление поездки' : 'Новая поездка'}: ${fields.title} (${tripId})`);

  // Обновить исходную заметку
  const publishedUrl = `https://erozanov.github.io/trips/${tripId}/`;
  const mark = `\n\n---\n\nstatus: опубликовано\npublished: ${new Date().toISOString().slice(0, 10)}\nurl: ${publishedUrl}\n`;
  writeFileSync(notePath, raw.replace(/^(---\n[\s\S]*?)\nstatus:\s*готово/, '$1\nstatus: опубликовано') + mark);
  console.log(`✓ Готово: ${publishedUrl}`);
  process.exit(0);
}

// ─── Режим MOMENT: добавить заметку в поездку ────────────────────────────────

for (const key of ['trip', 'city', 'title', 'date']) {
  if (!fields[key]) fail(`В frontmatter нет поля «${key}». См. PUBLISHING.md.`);
}
if (!/^\d{4}-\d{2}-\d{2}$/.test(fields.date)) fail(`Дата «${fields.date}» не в формате YYYY-MM-DD.`);

// Поиск поездки
const tripsDir = path.join(repoRoot, 'src/content/trips');
const tripFiles = readdirSync(tripsDir).filter((f) => f.endsWith('.md'));
const tripFile = tripFiles.find((f) => f.replace(/\.md$/, '') === fields.trip)
  ?? tripFiles.find((f) => readFileSync(path.join(tripsDir, f), 'utf8').includes(`title: "${fields.trip}"`));
if (!tripFile) {
  fail(`Поездка «${fields.trip}» не найдена. Доступны: ${tripFiles.map((f) => f.replace(/\.md$/, '')).join(', ')}.`);
}
const tripId = tripFile.replace(/\.md$/, '');
const tripSource = readFileSync(path.join(tripsDir, tripFile), 'utf8');

// Поиск города
const cityBlock = tripSource.match(
  new RegExp(`- name:\\s*"${fields.city.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}"[\\s\\S]*?(?=\\n  - name:|\\n---)`),
);
if (!cityBlock) {
  fail(
    `Город «${fields.city}» не найден в поездке «${tripId}». `
    + `Добавьте в src/content/trips/${tripFile} блок:\n`
    + `  - name: "${fields.city}"\n    slug: "…"\n    tagline: "…"\n    image: "…"\n    imageAlt: "…"\n    coordinates: { lat: …, lng: … }`,
  );
}
const citySlug = cityBlock[0].match(/slug:\s*"([^"]+)"/)?.[1];
if (!citySlug) fail(`У города «${fields.city}» не указан slug в ${tripFile}.`);

// Медиа
const embeds = [...bodyRaw.matchAll(/!\[\[([^\]|\n]+?)(?:\|([^\]\n]+))?\]\]/g)];
const attachments = embeds.map(([, file, alias]) => ({ file: path.basename(file.trim()), alt: (alias ?? '').trim() }));
if (attachments.length === 0) fail('В заметке нет вложений ![[...]] — нечего публиковать.');

const dateCompact = fields.date.replaceAll('-', '');
const media = [];

attachments.forEach((att, index) => {
  const ext = path.extname(att.file).toLowerCase();
  const isVideo = ['.mp4', '.mov', '.webm'].includes(ext);
  const key = `${tripId}/${citySlug}/${fields.date}-${String(index + 1).padStart(2, '0')}${isVideo ? '.mp4' : ext}`;

  if (isVideo) {
    processVideo(att.file, key);
  } else {
    processImage(att.file, key);
  }

  if (isVideo) {
    console.log(`! Видео «${att.file}» скопировано без обработки (${key}). Для сжатия нужен ffmpeg.`);
  }

  const item = { type: isVideo ? 'video' : 'photo', src: key, alt: att.alt };
  if (fields.best && path.basename(fields.best) === att.file) item.best = true;
  media.push(item);
});

// Файл момента
const momentsDir = path.join(repoRoot, 'src/content/moments');
let momentId = `${tripId}-${dateCompact}`;
let suffix = 1;
while (existsSync(path.join(momentsDir, `${momentId}.md`))) {
  suffix += 1;
  momentId = `${tripId}-${dateCompact}-${suffix}`;
}

const text = bodyRaw
  .replace(/!\[\[[^\]]*\]\]/g, '')
  .trim();
const tags = (fields.tags ?? '').split(',').map((t) => t.trim()).filter(Boolean);

const moment =
  `---\n`
  + `title: "${fields.title.replaceAll('"', "'")}"\n`
  + `trip: ${tripId}\n`
  + `city: "${fields.city}"\n`
  + `citySlug: ${citySlug}\n`
  + `date: ${fields.date}\n`
  + `tags: [${tags.join(', ')}]\n`
  + `media:\n`
  + media
    .map((item) => {
      const lines = [`  - type: ${item.type}`, `    src: "${item.src}"`, `    alt: "${item.alt.replaceAll('"', "'")}"`];
      if (item.best) lines.push('    best: true');
      return lines.join('\n');
    })
    .join('\n')
  + `\n---\n\n`
  + text
  + '\n';

writeFileSync(path.join(momentsDir, `${momentId}.md`), moment);
console.log(`✓ Создана заметка блога: src/content/moments/${momentId}.md`);

syncBackups();
gitPush(`Публикация: ${fields.title} (${momentId})`);

// Отметка в исходной заметке
const publishedUrl = `https://erozanov.github.io/trips/${tripId}/#${momentId}`;
const mark =
  `\n\n---\n\nstatus: опубликовано\npublished: ${fields.date}\nurl: ${publishedUrl}\n`
  + `media:\n${media.map((m) => `  - "${m.src}"`).join('\n')}\n`;
writeFileSync(notePath, raw.replace(/^(---\n[\s\S]*?)\nstatus:\s*готово/, '$1\nstatus: опубликовано') + mark);
console.log(`✓ Готово: ${publishedUrl}`);
