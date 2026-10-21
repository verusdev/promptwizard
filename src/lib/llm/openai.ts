import { OpenAiChatResponseSchema } from '../schemas.js';
import { LlmRequestError } from '../engine/errors.js';
import { maskSecret } from '../config.js';
import { postJson, type LLMProvider } from './provider.js';

/**
 * OpenAI-совместимый провайдер: POST {base_url}/chat/completions.
 * Поддерживает кастомный base_url (PROMPTWIZARD_LLM_BASE_URL) — локальные
 * прокси и совместимые серверы (LM Studio, Ollama-прокси и т.п.).
 */

const DEFAULT_BASE_URL = 'https://api.openai.com/v1';
const DEFAULT_MODEL = 'gpt-4o-mini';

export interface OpenAiProviderOptions {
  apiKey: string;
  baseUrl: string | null;
  model: string | null;
}

export function createOpenAiProvider(options: OpenAiProviderOptions): LLMProvider {
  const base = (options.baseUrl ?? DEFAULT_BASE_URL).trim().replace(/\/+$/, '');
  const model = (options.model ?? DEFAULT_MODEL).trim();
  const maskedKey = maskSecret(options.apiKey);

  return {
    async refine(system: string, user: string): Promise<string> {
      const data = await postJson({
        url: `${base}/chat/completions`,
        serviceName: 'OpenAI-совместимый API',
        maskedKey,
        init: {
          method: 'POST',
          headers: {
            'content-type': 'application/json',
            authorization: `Bearer ${options.apiKey}`,
          },
          body: JSON.stringify({
            model,
            messages: [
              { role: 'system', content: system },
              { role: 'user', content: user },
            ],
          }),
        },
      });

      const parsed = OpenAiChatResponseSchema.safeParse(data);
      if (!parsed.success) {
        throw new LlmRequestError(
          'OpenAI-совместимый API: неожиданный формат ответа (нет choices[0].message.content) — ' +
            'проверьте, что base URL указывает на OpenAI-совместимый /v1.',
        );
      }
      const content = parsed.data.choices[0]?.message.content;
      if (content === null || content === undefined || content.trim() === '') {
        throw new LlmRequestError(
          'OpenAI-совместимый API: вернул пустой ответ — попробуйте ещё раз.',
        );
      }
      return content.trim();
    },
  };
}
