import { defineConfig } from 'tsup';
import { resolve } from 'node:path';

// Dual ESM+CJS build for Node + a third ESM-only build for browser/renderer
// contexts (Phase 5 / D-VW-10). All three share src/ — the browser build uses
// an esbuild resolve-plugin to swap `_internal/{debuglog,event-emitter,sleep,read-file}.js`
// imports with their `.browser.ts` siblings. Browser variants have zero
// `node:` imports and can be bundled into Vite/webpack/rollup output without
// polyfills.
//
// v2 (BlenoTransport) forward-shape:
//   entry: { index: 'src/index.ts', bleno: 'src/bleno.ts' },
//   external: ['@stoprocent/bleno'],
// — keeps consumers who import only `trainer-sim` (not `trainer-sim/bleno`)
// off the native-deps path. Phase 1 has zero native deps (D-14).
//
// The browser entry uses `target: 'es2022'` (no Node-version-specific syntax)
// and `platform: 'browser'` so esbuild does not auto-resolve any remaining
// `node:*` specifier — if a future change re-introduces one, the build fails
// loudly instead of producing a broken bundle.

const browserAliasMap: Record<string, string> = {
  'debuglog.js': 'debuglog.browser.ts',
  'event-emitter.js': 'event-emitter.browser.ts',
  'sleep.js': 'sleep.browser.ts',
  'read-file.js': 'read-file.browser.ts',
};

export default defineConfig([
  {
    entry: { index: 'src/index.ts' },
    format: ['esm', 'cjs'],
    dts: true,
    sourcemap: true,
    treeshake: true,
    clean: true,
    target: 'node24',
    outDir: 'dist',
  },
  {
    entry: { 'index.browser': 'src/index.ts' },
    format: ['esm'],
    dts: false,
    sourcemap: true,
    treeshake: true,
    clean: false,
    target: 'es2022',
    platform: 'browser',
    outDir: 'dist',
    esbuildPlugins: [
      {
        name: 'trainer-sim-browser-aliases',
        setup(build) {
          build.onResolve({ filter: /\/_internal\/[a-z-]+\.js$/ }, (args) => {
            const name = args.path.split('/').pop() as string;
            const replacement = browserAliasMap[name];
            if (!replacement) return undefined;
            return { path: resolve(process.cwd(), 'src', '_internal', replacement) };
          });
        },
      },
    ],
  },
]);
