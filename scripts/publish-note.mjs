#!/usr/bin/env node
/**
 * Публикация заметки из Obsidian в блог.
 *
 * Использование:
 *   node scripts/publish-note.mjs <путь-к-заметке> [--no-push]
 *
 * Ожидает заметку, подготовленную по ранбуку PUBLISHING.md:
 * frontmatter со status: готово, trip, city, title, date + вложения рядом с заметкой.
 *
 * Окружение (для публикации медиа в R2 вместо репозитория):
 *   PUBLISH_TARGET=r2 R2_BUCKET=sledom-media R2_PUBLIC_URL=https://pub-xxx.r2.dev CLOUDFLARE_API_TOKEN=...
 */
import { copyFileSync, existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import path from 'node:path';

const repoRoot = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const config = {
  target: process.env.PUBLISH_TARGET ?? 'local', // local | r2
  r2Bucket: process.env.R2_BUCKET ?? 'sledom-media',
  r2PublicUrl: (process.env.R2_PUBLIC_URL ?? '').replace(/\/$/, ''),
  localMediaDir: 'public/media',
  photosMaxSize: 2000,
};

const [, , notePathArg, ...flags] = process.argv;
const push = !flags.includes('--no-push');
if (!notePathArg) {
  console.error('Укажите путь к заметке: node scripts/publish-note.mjs <заметка>');
  process.exit(1);
}
const notePath = path.resolve(notePathArg);
const noteDir = path.dirname(notePath);

function fail(message) {
  console.error(`\n✗ ${message}`);
  process.exit(1);
}

// --- Разбор заметки ---

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
for (const key of ['trip', 'city', 'title', 'date']) {
  if (!fields[key]) fail(`В frontmatter нет поля «${key}».`);
}
if (!/^\d{4}-\d{2}-\d{2}$/.test(fields.date)) fail(`Дата «${fields.date}» не в формате YYYY-MM-DD.`);

// --- Поиск поездки и города ---

const tripsDir = path.join(repoRoot, 'src/content/trips');
const tripFiles = readdirSync(tripsDir).filter((f) => f.endsWith('.md'));
const tripFile = tripFiles.find((f) => f.replace(/\.md$/, '') === fields.trip)
  ?? tripFiles.find((f) => readFileSync(path.join(tripsDir, f), 'utf8').includes(`title: "${fields.trip}"`));
if (!tripFile) {
  fail(`Поездка «${fields.trip}» не найдена. Доступны: ${tripFiles.map((f) => f.replace(/\.md$/, '')).join(', ')}.`);
}
const tripId = tripFile.replace(/\.md$/, '');
const tripSource = readFileSync(path.join(tripsDir, tripFile), 'utf8');

// Город ищем по имени в списке cities поездки; если не нашли — показываем, что добавить.
const cityBlock = tripSource.match(new RegExp(`- name:\\s*"${fields.city.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}"[\\s\\S]*?(?=\\n  - name:|\\n---)`));
if (!cityBlock) {
  fail(
    `Город «${fields.city}» нет в поездке «${tripId}». Добавьте в ${path.join('src/content/trips', tripFile)} блок:\n`
    + `  - name: "${fields.city}"\n    slug: "…"\n    tagline: "…"\n    image: "…"\n    imageAlt: "…"\n    coordinates: { lat: …, lng: … }`,
  );
}
const citySlug = cityBlock[0].match(/slug:\s*"([^"]+)"/)?.[1];
if (!citySlug) fail(`У города «${fields.city}» не указан slug в ${tripFile}.`);

// --- Медиа ---

const embeds = [...bodyRaw.matchAll(/!\[\[([^\]|\n]+?)(?:\|([^\]\n]+))?\]\]/g)];
const attachments = embeds.map(([, file, alias]) => ({ file: path.basename(file.trim()), alt: (alias ?? '').trim() }));
if (attachments.length === 0) fail('В заметке нет вложений ![[...]] и нет текста — нечего публиковать.');

const dateCompact = fields.date.replaceAll('-', '');
const media = [];
attachments.forEach((att, index) => {
  const src = path.join(noteDir, att.file);
  if (!existsSync(src)) fail(`Файл «${att.file}» не найран рядом с заметкой (${noteDir}).`);
  const ext = path.extname(att.file).toLowerCase();
  const isVideo = ['.mp4', '.mov', '.webm'].includes(ext);
  const key = `${tripId}/${citySlug}/${fields.date}-${String(index + 1).padStart(2, '0')}${isVideo ? '.mp4' : ext}`;
  let publicSrc;

  if (config.target === 'r2') {
    if (!config.r2PublicUrl) fail('Задан PUBLISH_TARGET=r2, но не задан R2_PUBLIC_URL.');
    const tmp = path.join('/tmp', `publish-${Date.now()}-${index}${ext}`);
    if (isVideo) copyFileSync(src, tmp);
    else execFileSync('sips', ['-Z', String(config.photosMaxSize), src, '--out', tmp], { stdio: 'ignore' });
    execFileSync('npx', ['wrangler', 'r2', 'object', 'put', `${config.r2Bucket}/${key}`, '--file', tmp, '--remote'], { stdio: 'inherit' });
    publicSrc = `${config.r2PublicUrl}/${key}`;
  } else {
    const dest = path.join(repoRoot, config.localMediaDir, key);
    mkdirSync(path.dirname(dest), { recursive: true });
    if (isVideo) {
      copyFileSync(src, dest);
      console.log(`! Видео «${att.file}» скопировано без обработки (${key}). Для сжатия нужен ffmpeg.`);
    } else {
      execFileSync('sips', ['-Z', String(config.photosMaxSize), src, '--out', dest], { stdio: 'ignore' });
    }
    publicSrc = `/media/${key}`;
  }

  const item = { type: isVideo ? 'video' : 'photo', src: publicSrc, alt: att.alt };
  if (fields.best && path.basename(fields.best) === att.file) item.best = true;
  if (isVideo) item.poster = undefined;
  media.push(item);
  console.log(`✓ ${att.file} → ${publicSrc}`);
});

// --- Файл момента ---

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

const moment = `---
title: "${fields.title.replaceAll('"', "'")}"
trip: ${tripId}
city: "${fields.city}"
citySlug: ${citySlug}
date: ${fields.date}
tags: [${tags.join(', ')}]
media:
${media
  .map((item) => {
    const lines = [`  - type: ${item.type}`, `    src: "${item.src}"`, `    alt: "${item.alt.replaceAll('"', "'")}"`];
    if (item.best) lines.push('    best: true');
    return lines.join('\n');
  })
  .join('\n')}
---

${text}
`;
writeFileSync(path.join(momentsDir, `${momentId}.md`), moment);
console.log(`✓ Создана заметка блога: src/content/moments/${momentId}.md`);

// --- Публикация ---

if (push) {
  execFileSync('git', ['add', '-A'], { cwd: repoRoot, stdio: 'ignore' });
  execFileSync('git', ['commit', '-m', `Публикация: ${fields.title} (${momentId})`], { cwd: repoRoot, stdio: 'ignore' });
  execFileSync('git', ['push'], { cwd: repoRoot, stdio: 'inherit' });
  console.log('✓ Запушено — деплой начнётся через минуту.');
} else {
  console.log('(--no-push: коммит и пуш пропущены)');
}

// --- Отметка в исходной заметке ---

const publishedUrl = `https://erozanov.github.io/trips/${tripId}/#${momentId}`;
const mark = `\n\n---\n\nstatus: опубликовано\npublished: ${fields.date}\nurl: ${publishedUrl}\nmedia:\n${media.map((m) => `  - "${m.src}"`).join('\n')}\n`;
writeFileSync(notePath, raw.replace(/^(---\n[\s\S]*?)\nstatus:\s*готово/, `$1\nstatus: опубликовано`) + mark);
console.log(`✓ Готово: ${publishedUrl}`);
