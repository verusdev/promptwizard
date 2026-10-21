/**
 * Глобальная защита от сети в тестах (M5, VERIFY «реальных сетевых запросов нет»).
 *
 * Любая попытка вызвать настоящий fetch (в юнит-тестах) падает с явной ошибкой:
 * тесты обязаны установить свой мок через vi.stubGlobal('fetch', ...).
 * Интеграционные тесты CLI spawn'ят дочерние процессы — там проверка иная:
 * ни один тест не передаёт валидный PROMPTWIZARD_LLM_API_KEY, поэтому
 * провайдер не создаётся и fetch не вызывается (см. tests/cli/*.test.ts).
 */
const globalWithFetch = globalThis as { fetch?: typeof fetch };
globalWithFetch.fetch = ((input: unknown) => {
  throw new Error(
    `Сеть запрещена в тестах: вызван реальный fetch (${String(input)}). Замокайте fetch в тесте.`,
  );
}) as typeof fetch;
