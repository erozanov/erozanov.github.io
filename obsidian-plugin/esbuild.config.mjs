import esbuild from 'esbuild';
import process from 'process';
import builtins from 'builtin-modules';

const dev = process.argv[2] === 'dev';

const options = {
  entryPoints: ['src/main.ts'],
  bundle: true,
  external: ['obsidian', 'electron', ...builtins],
  format: 'cjs',
  target: 'es2018',
  logLevel: 'info',
  sourcemap: dev ? 'inline' : false,
  treeShaking: true,
  outfile: 'main.js',
};

if (dev) {
  const ctx = await esbuild.context(options);
  await ctx.watch();
  console.log('Сборка в режиме наблюдения — пересборка при изменениях.');
} else {
  await esbuild.build(options);
  console.log('Готово: main.js собран.');
}
