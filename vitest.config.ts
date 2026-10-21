import { defineConfig } from 'vitest/config';

/**
 * Конфигурация тестов PromptWizard (Milestone M5).
 *
 * Принципы:
 * - сеть в тестах ЗАПРЕЩЕНА: tests/setup.ts подменяет globalThis.fetch
 *   «сторожем», который бросает ошибку на любой незамоканный вызов;
 * - интеграционные тесты CLI spawn'ят dist/index.js (нужен npm run build);
 * - покрытие: движок (src/lib/engine/**) и реестр шаблонов держат ≥ 90%
 *   (порог зафиксирован в coverage.thresholds — падает прогон при регрессе).
 */
export default defineConfig({
  test: {
    include: ['tests/**/*.test.ts'],
    setupFiles: ['tests/setup.ts'],
    environment: 'node',
    // pool 'forks': настоящие процессы — работают process.chdir и моки node:fs.
    pool: 'forks',
    testTimeout: 30_000,
    hookTimeout: 30_000,
    // Чистота тестов: моки сбрасываются, stubGlobal (fetch) откатывается сам.
    mockReset: true,
    unstubGlobals: true,
    coverage: {
      provider: 'v8',
      include: [
        'src/lib/engine/**/*.ts',
        'src/lib/templates/registry.ts',
        'src/lib/config.ts',
        'src/lib/schemas.ts',
        'src/lib/llm/**/*.ts',
      ],
      reporter: ['text', 'json-summary'],
      thresholds: {
        // Юнит-покрытие T15: движок и реестр ≥ 90% по строкам/функциям.
        'src/lib/engine/**/*.ts': {
          lines: 90,
          statements: 90,
          functions: 90,
          branches: 80,
        },
        'src/lib/templates/registry.ts': {
          lines: 90,
          statements: 90,
          functions: 90,
          branches: 80,
        },
      },
    },
  },
});
