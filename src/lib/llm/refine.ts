import type { LLMProvider } from './provider.js';

/**
 * Сценарий LLM-доработки промта (T13/T14).
 *
 * Системный промпт фиксирует контракт: модель улучшает текст, сохраняет
 * намерение автора и возвращает ТОЛЬКО итоговый промт (без пояснений).
 */

export const REFINE_SYSTEM_PROMPT = [
  'Ты — редактор промтов для генеративных моделей (изображения, код, тексты, видео, музыка).',
  'Улучши переданный промт: сделай его яснее, точнее и более эффективным для целевой модели.',
  'Строго сохраняй намерение автора — не меняй цель, сюжет, ключевые детали и параметры.',
  'Верни ТОЛЬКО итоговый промт: без пояснений, без кавычек и без обёрток вроде ```.',
].join(' ');

/** Пользовательская часть запроса: опциональная цель доработки + текст промта. */
export function buildRefineUserMessage(promptText: string, goal?: string): string {
  const trimmedGoal = goal?.trim();
  if (trimmedGoal !== undefined && trimmedGoal !== '') {
    return `Цель доработки: ${trimmedGoal}\n\nПромт:\n${promptText}`;
  }
  return `Промт:\n${promptText}`;
}

/**
 * Дорабатывает текст промта через провайдер.
 * Возвращает только доработанный текст; при ошибке LLM — типизированная LlmRequestError,
 * исходный текст не изменяется (он остаётся у вызывающей стороны).
 */
export async function refineText(
  provider: LLMProvider,
  promptText: string,
  goal?: string,
): Promise<string> {
  return provider.refine(REFINE_SYSTEM_PROMPT, buildRefineUserMessage(promptText, goal));
}
