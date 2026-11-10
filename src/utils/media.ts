const base = (import.meta.env.MEDIA_BASE_URL as string | undefined)?.replace(/\/+$/, '');

/**
 * Превращает логический ключ медиа (например, "china/sanya/2026-10-13-01.jpg")
 * в URL для отдачи. Хост задаётся переменной MEDIA_BASE_URL при сборке;
 * по умолчанию файлы отдаются из public/media самого сайта.
 * Абсолютные http(s)-URL возвращаются как есть — для обратной совместимости.
 */
export function mediaSrc(key: string): string {
  if (/^https?:\/\//.test(key)) return key;
  return `${base ?? '/media'}/${key.replace(/^\/+/, '')}`;
}
