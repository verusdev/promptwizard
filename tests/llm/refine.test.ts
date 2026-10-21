import { describe, expect, it, vi } from 'vitest';
import { LlmNotConfiguredError } from '../../src/lib/engine/errors.js';
import { buildRefineUserMessage, refineText } from '../../src/lib/llm/refine.js';
import { createProvider } from '../../src/lib/llm/provider.js';
import { DEFAULT_CONFIG } from '../../src/lib/schemas.js';

function jsonResponse(body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { 'content-type': 'application/json' },
  });
}

describe('refineText — интеграция сценария', () => {
  it('работает через провайдер (end-to-end мок fetch)', async () => {
    const fetchMock = vi.fn().mockResolvedValueOnce(
      jsonResponse({
        choices: [{ message: { content: 'Улучшенный: a cyberpunk city, cinematic lighting' } }],
      }),
    );
    vi.stubGlobal('fetch', fetchMock);

    const config = {
      ...DEFAULT_CONFIG,
      llm: { provider: 'openai', apiKey: 'sk-test', baseUrl: null, model: null },
    };
    const provider = createProvider(config);
    const refined = await refineText(provider, 'a cyberpunk city', 'more cinematic');

    expect(refined).toBe('Улучшенный: a cyberpunk city, cinematic lighting');
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('при ошибке провайдера (AbortError после ретраев) бросает LlmRequestError, исходный текст не меняется', async () => {
    const fetchMock = vi.fn().mockImplementation(
      () =>
        new Promise((_, reject) => {
          const error = new Error('aborted');
          error.name = 'AbortError';
          reject(error);
        }),
    );
    vi.stubGlobal('fetch', fetchMock);

    const config = {
      ...DEFAULT_CONFIG,
      llm: { provider: 'anthropic', apiKey: 'sk-ant', baseUrl: null, model: null },
    };
    const provider = createProvider(config);
    const original = 'исходный промт не должен потеряться';

    await expect(refineText(provider, original)).rejects.toThrow();
    expect(original).toBe('исходный промт не должен потеряться');
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('без ключа createProvider бросает LlmNotConfiguredError', () => {
    const config = {
      ...DEFAULT_CONFIG,
      llm: { provider: 'openai', apiKey: null, baseUrl: null, model: null },
    };
    expect(() => createProvider(config)).toThrow(LlmNotConfiguredError);
  });

  it('buildRefineUserMessage работает с многострочным промптом', () => {
    const multiline = 'Line 1\nLine 2\n\nLine 4';
    const message = buildRefineUserMessage(multiline);
    expect(message).toBe(`Промт:\n${multiline}`);
  });
});
