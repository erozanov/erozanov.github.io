// @ts-check
import { defineConfig } from 'astro/config';
import sitemap from '@astrojs/sitemap';

// Домен сайта — нужен для sitemap, Open Graph и канонических ссылок.
export default defineConfig({
  site: 'https://erozanov.github.io',
  integrations: [sitemap()],
});
