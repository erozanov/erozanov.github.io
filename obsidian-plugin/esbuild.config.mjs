import esbuild from 'esbuild';
import process from 'process';
import builtins from 'builtin-modules';

const dev = process.argv[2] === 'dev';

esbuild.build({
  entryPoints: ['src/main.ts'],
  bundle: true,
  external: ['obsidian', 'electron', ...builtins],
  format: 'cjs',
  target: 'es2018',
  logLevel: 'info',
  sourcemap: dev ? 'inline' : false,
  treeShaking: true,
  outfile: 'main.js',
  watch: dev
    ? { onRebuild: (err) => { if (!err) console.log('Rebuilt.'); } }
    : undefined,
});
