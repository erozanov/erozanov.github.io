#!/usr/bin/env node
/**
 * Синхронизация медиа и бэкапов:
 *
 * 1. Синхронизирует оригиналы из media-originals/ на домашний NAS (Synology через rsync).
 * 2. Синхронизирует оригиналы во второе облако (Backblaze B2, Google Drive через rclone).
 * 3. Если передан флаг --pull-r2: скачивает новые медиа из Cloudflare R2 в локальный архив
 *    (полезно, если публиковались через Telegram с телефона).
 *
 * Использование:
 *   node scripts/sync-media.mjs [--pull-r2]
 *
 * Переменные окружения:
 *   MEDIA_NAS_PATH=/Volumes/synology/photo-archive (или user@nas:/volume1/photos)
 *   MEDIA_CLOUD_BACKUP=b2:my-bucket-backup (или gdrive:TravelArchive)
 *   R2_BUCKET=sledom-media
 */

import { existsSync, mkdirSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import path from 'node:path';

const repoRoot = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const originalsDir = path.join(repoRoot, 'media-originals');
const mirrorDir = path.join(repoRoot, 'media-mirror');

const nasTarget = process.env.MEDIA_NAS_PATH ?? process.env.MEDIA_MIRROR_PATH ?? '';
const cloudBackup = process.env.MEDIA_CLOUD_BACKUP ?? '';
const r2Bucket = process.env.R2_BUCKET ?? 'sledom-media';

const flags = process.argv.slice(2);
const pullR2 = flags.includes('--pull-r2');

console.log('🔄 Запуск синхронизации медиаархива...');

// ─── 1. Скачивание из R2 (если публикуем через Telegram в поездке) ───────────

if (pullR2) {
  console.log(`\n📥 Подтягиваем медиа из Cloudflare R2 (${r2Bucket})...`);
  mkdirSync(mirrorDir, { recursive: true });

  // Пробуем rclone, если настроен remote для R2
  try {
    execFileSync('rclone', ['sync', `r2:${r2Bucket}`, mirrorDir, '--fast-list', '-v'], { stdio: 'inherit' });
    console.log('✓ Медиа из R2 успешно скачаны в локальное зеркало.');
  } catch {
    console.log('! rclone remote "r2" не настроен. Для скачивания через rclone выполните: rclone config');
  }
}

// ─── 2. Синхронизация на Synology NAS / Домашнее хранилище ───────────────────

if (nasTarget) {
  console.log(`\n🏠 Синхронизация на домашнее хранилище (NAS): ${nasTarget}...`);
  if (!existsSync(originalsDir)) mkdirSync(originalsDir, { recursive: true });

  try {
    execFileSync(
      'rsync',
      ['-av', '--delete', `${originalsDir}/`, nasTarget.replace(/\/?$/, '/')],
      { stdio: 'inherit' },
    );
    console.log('✓ Оригиналы успешно синхронизированы на NAS.');
  } catch (err) {
    console.error(`✗ Ошибка rsync на NAS (${nasTarget}). Проверьте подключение диска/сети.`);
  }
} else {
  console.log('\nℹ️ MEDIA_NAS_PATH не задан — синхронизация на домашний NAS пропущена.');
}

// ─── 3. Синхронизация во второе облако (Backblaze B2 / GDrive) ────────────────

if (cloudBackup) {
  console.log(`\n☁️ Синхронизация во второе облако: ${cloudBackup}...`);
  try {
    execFileSync('rclone', ['sync', originalsDir, cloudBackup, '--fast-list', '-v'], { stdio: 'inherit' });
    console.log('✓ Оригиналы успешно загружены в облачный бэкап.');
  } catch (err) {
    console.error(`✗ Ошибка rclone в ${cloudBackup}. Проверьте rclone config.`);
  }
} else {
  console.log('ℹ️ MEDIA_CLOUD_BACKUP не задан — синхронизация во второе облако пропущена.');
}

console.log('\n✨ Синхронизация завершена!');
