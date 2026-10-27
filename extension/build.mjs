// esbuild bundles each entry into ONE classic script (no require/import left),
// which is what Chrome content scripts and MV3 service workers need.
import { build, context } from 'esbuild';

const watch = process.argv.includes('--watch');

const shared = {
  bundle: true,
  format: 'iife',
  target: 'chrome110',
  sourcemap: true,
  logLevel: 'info',
  loader: { '.css': 'text' } // overlay.css is inlined as a string for the Shadow DOM
};

const entries = [
  { entryPoints: ['content/content.ts'], outfile: 'dist/content/content.js' },
  { entryPoints: ['background/service-worker.ts'], outfile: 'dist/background/service-worker.js' }
];

if (watch) {
  for (const e of entries) {
    const ctx = await context({ ...shared, ...e });
    await ctx.watch();
  }
  console.log('Watching for changes... (reload the extension in chrome://extensions after rebuilds)');
} else {
  await Promise.all(entries.map((e) => build({ ...shared, ...e })));
}
