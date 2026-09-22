import { defineConfig } from 'vite-plus';

export default defineConfig({
  staged: {
    '*': 'vp check --fix',
  },

  lint: {
    jsPlugins: [{ name: 'vite-plus', specifier: 'vite-plus/oxlint-plugin' }],
    rules: { 'vite-plus/prefer-vite-plus-imports': 'error' },
    options: { typeAware: true, typeCheck: true },
  },

  pack: {
    deps: { resolveDepSubpath: true },
    entry: 'src/index.ts',
    platform: 'neutral',
    sourcemap: true,
    minify: false,
    target: 'esnext',
    format: ['cjs', 'es'],
    exports: true,
    publint: true,
  },

  fmt: {
    printWidth: 120,
    singleQuote: true,
    trailingComma: 'all',
    experimentalSortImports: {
      groups: [],
    },
    experimentalSortPackageJson: true,
  },

  test: {
    coverage: {
      reporter: ['text', 'json-summary', 'json'],
      reportOnFailure: true,
    },
    reporters: process.env.CI ? ['dot', 'github-actions', ['junit', { outputFile: 'test-results.xml' }]] : ['default'],
  },
});
