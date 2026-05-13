import { defineConfig } from 'tsup';

// Dual ESM+CJS build with .d.ts/.d.cts emission per CONTEXT.md D-11.
// tsup target node24 matches package.json engines (>=24.0, D-16).
//
// v2 (BlenoTransport) forward-shape:
//   entry: { index: 'src/index.ts', bleno: 'src/bleno.ts' },
//   external: ['@stoprocent/bleno'],
// — keeps consumers who import only `trainer-sim` (not `trainer-sim/bleno`)
// off the native-deps path. Phase 1 has zero native deps (D-14).
export default defineConfig({
  entry: ['src/index.ts'],
  format: ['esm', 'cjs'],
  dts: true,
  sourcemap: true,
  treeshake: true,
  clean: true,
  target: 'node24',
  outDir: 'dist',
});
