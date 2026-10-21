import { AnthropicMessagesResponseSchema } from '../schemas.js';
import { LlmRequestError } from '../engine/errors.js';
import { maskSecret } from '../config.js';
import { postJson, type LLMProvider } from './provider.js';

/**
 * Anthropic провайдер: POST {base_url}/v1/messages.
 * Заголовки: x-api-key + anthropic-version (2023-06-01).
 */

const DEFAULT_BASE_URL = 'https://api.anthropic.com';
const DEFAULT_MODEL = 'claude-3-5-sonnet-latest';
const ANTHROPIC_VERSION = '2023-06-01';
/** Максимум токенов ответа: refine возвращает только текст промта — 4096 достаточно. */
const MAX_TOKENS = 4096;

export interface AnthropicProviderOptions {
  apiKey: string;
  baseUrl: string | null;
  model: string | null;
}

export function createAnthropicProvider(options: AnthropicProviderOptions): LLMProvider {
  const base = (options.baseUrl ?? DEFAULT_BASE_URL).trim().replace(/\/+$/, '');
  const model = (options.model ?? DEFAULT_MODEL).trim();
  const maskedKey = maskSecret(options.apiKey);

  return {
    async refine(system: string, user: string): Promise<string> {
      const data = await postJson({
        url: `${base}/v1/messages`,
        serviceName: 'Anthropic API',
        maskedKey,
        init: {
          method: 'POST',
          headers: {
            'content-type': 'application/json',
            'x-api-key': options.apiKey,
            'anthropic-version': ANTHROPIC_VERSION,
          },
          body: JSON.stringify({
            model,
            max_tokens: MAX_TOKENS,
            system,
            messages: [{ role: 'user', content: user }],
          }),
        },
      });

      const parsed = AnthropicMessagesResponseSchema.safeParse(data);
      if (!parsed.success) {
        throw new LlmRequestError(
          'Anthropic API: неожиданный формат ответа (нет content-блока с типом "text").',
        );
      }
      const text = parsed.data.content
        .filter((block) => block.type === 'text' && typeof block.text === 'string')
        .map((block) => block.text ?? '')
        .join('')
        .trim();
      if (text === '') {
        throw new LlmRequestError('Anthropic API: вернул пустой ответ — попробуйте ещё раз.');
      }
      return text;
    },
  };
}
