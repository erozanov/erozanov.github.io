// @ts-check
import { defineConfig } from 'astro/config';
import sitemap from '@astrojs/sitemap';

// Замените на реальный домен сайта — он нужен для sitemap и Open Graph.
export default defineConfig({
  site: 'https://sledom.blog',
  integrations: [sitemap()],
});
