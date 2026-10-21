import type { Config } from '../schemas.js';
import { LlmNotConfiguredError, LlmRequestError } from '../engine/errors.js';
import { createOpenAiProvider } from './openai.js';
import { createAnthropicProvider } from './anthropic.js';

/**
 * Провайдер LLM: единственная точка интеграции движка CLI с сетью.
 * Движок промтов (engine/**) от этой абстракции не зависит.
 */
export interface LLMProvider {
  /** Доработка текста: system — сценарий доработки, user — текст промта; возвращает ТОЛЬКО новый текст. */
  refine(system: string, user: string): Promise<string>;
}

/** Таймаут одного HTTP-запроса к LLM API (AbortController). */
export const LLM_REQUEST_TIMEOUT_MS = 15_000;

/**
 * Фабрика провайдера по конфигурации.
 * Без API-ключа — типизированная LlmNotConfiguredError (не generic Error).
 */
export function createProvider(config: Config): LLMProvider {
  const llm = config.llm;
  if (llm.apiKey === null || llm.apiKey === '') {
    throw new LlmNotConfiguredError();
  }
  const options = {
    apiKey: llm.apiKey,
    baseUrl: llm.baseUrl,
    model: llm.model,
  };
  switch (llm.provider) {
    case 'openai':
      return createOpenAiProvider(options);
    case 'anthropic':
      return createAnthropicProvider(options);
  }
}

/* ------------------------------------------------------------------ */
/* Общий HTTP-хелпер: таймаут, 1 ретрай, нормализация ошибок          */
/* ------------------------------------------------------------------ */

export interface PostJsonOptions {
  url: string;
  /** RequestInit без signal — signal управляет хелпер (таймаут + ретрай). */
  init: Omit<RequestInit, 'signal'>;
  /** Имя сервиса для сообщений об ошибках, например "OpenAI-совместимый API". */
  serviceName: string;
  /** Маска API-ключа для сообщений 401/403 (сам ключ не печатается никогда). */
  maskedKey: string;
}

/**
 * POST-запрос с JSON-ответом:
 * - таймаут LLM_REQUEST_TIMEOUT_MS на каждую попытку (AbortController);
 * - ровно 1 ретрай на 5xx и сетевую ошибку/таймаут (4xx не ретраится);
 * - человекочитаемые ошибки: 401 → «ключ неверен», 429 → «лимит запросов»,
 *   таймаут → «нет сети/таймаут».
 */
export async function postJson(options: PostJsonOptions): Promise<unknown> {
  const maxAttempts = 2;
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), LLM_REQUEST_TIMEOUT_MS);
    try {
      const response = await fetch(options.url, {
        ...options.init,
        signal: controller.signal,
      });

      if (response.ok) {
        try {
          return (await response.json()) as unknown;
        } catch (error) {
          throw new LlmRequestError(
            `${options.serviceName}: сервер вернул не-JSON ответ — попробуйте позже или проверьте base URL (${errorText(error)})`,
          );
        }
      }

      const detail = await readErrorDetail(response);
      if (response.status >= 500 && attempt < maxAttempts) {
        continue; // ретрай ровно один раз на 5xx
      }
      throw httpStatusError(response.status, detail, options);
    } catch (error) {
      if (error instanceof LlmRequestError) {
        throw error;
      }
      // Сетевая ошибка или таймаут (AbortError).
      if (attempt < maxAttempts) {
        continue; // ретрай ровно один раз
      }
      throw transportError(error, controller, options);
    } finally {
      clearTimeout(timer);
    }
  }
  // Недостижимо (цикл всегда завершается return/throw), но TypeScript требует возврата.
  throw new LlmRequestError(`${options.serviceName}: запрос не выполнен (превышен лимит попыток)`);
}

function httpStatusError(
  status: number,
  detail: string,
  options: PostJsonOptions,
): LlmRequestError {
  const suffix = detail !== '' ? `: ${detail}` : '';
  if (status === 401 || status === 403) {
    return new LlmRequestError(
      `${options.serviceName}: ключ отклонён (HTTP ${status}) — API-ключ неверен или недействителен ` +
        `(задан как ${options.maskedKey}). Проверьте PROMPTWIZARD_LLM_API_KEY или config set llm.apiKey.`,
    );
  }
  if (status === 429) {
    return new LlmRequestError(
      `${options.serviceName}: превышен лимит запросов (HTTP 429) — подождите и повторите попытку.`,
    );
  }
  if (status === 400 || status === 404 || status === 422) {
    return new LlmRequestError(
      `${options.serviceName}: неверный запрос (HTTP ${status})${suffix} — проверьте модель (llm.model) и base URL (llm.baseUrl).`,
    );
  }
  return new LlmRequestError(`${options.serviceName}: HTTP ${status}${suffix}`);
}

function transportError(
  error: unknown,
  controller: AbortController,
  options: PostJsonOptions,
): LlmRequestError {
  if (controller.signal.aborted) {
    return new LlmRequestError(
      `${options.serviceName}: таймаут — сервис не ответил за ${LLM_REQUEST_TIMEOUT_MS / 1000} с ` +
        '(нет сети или сервис недоступен).',
    );
  }
  return new LlmRequestError(
    `${options.serviceName}: не удалось подключиться (${errorText(error)}) — проверьте сеть и base URL.`,
  );
}

/** Короткий фрагмент тела ошибки HTTP (без ключа — он в заголовках, не в теле). */
async function readErrorDetail(response: Response): Promise<string> {
  try {
    const text = await response.text();
    return text.trim().slice(0, 200);
  } catch {
    return response.statusText ?? '';
  }
}

function errorText(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
