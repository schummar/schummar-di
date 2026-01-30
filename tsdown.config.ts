import { defineConfig } from 'tsdown';

export default defineConfig({
  entry: 'src/index.ts',
  platform: 'neutral',
  sourcemap: true,
  minify: false,
  target: 'esnext',
  format: ['cjs', 'es'],
  exports: true,
});
