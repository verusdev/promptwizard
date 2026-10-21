import { describe, expect, it, vi } from 'vitest';
import { LlmNotConfiguredError, LlmRequestError } from '../../src/lib/engine/errors.js';
import { createAnthropicProvider } from '../../src/lib/llm/anthropic.js';
import { createOpenAiProvider } from '../../src/lib/llm/openai.js';
import { LLM_REQUEST_TIMEOUT_MS, createProvider, postJson } from '../../src/lib/llm/provider.js';
import {
  REFINE_SYSTEM_PROMPT,
  buildRefineUserMessage,
  refineText,
} from '../../src/lib/llm/refine.js';
import { DEFAULT_CONFIG } from '../../src/lib/schemas.js';

const SERVICE = 'Тестовый API';
const MASKED = 'sk-***';

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

function textResponse(body: string, status: number): Response {
  return new Response(body, { status, headers: { 'content-type': 'text/plain' } });
}

/* ------------------------------------------------------------------ */
/* Фабрика провайдера                                                   */
/* ------------------------------------------------------------------ */

describe('createProvider — фабрика по конфигу', () => {
  it('без ключа бросает LlmNotConfiguredError (типизированный, не generic Error)', () => {
    const config = {
      ...DEFAULT_CONFIG,
      llm: { ...DEFAULT_CONFIG.llm, provider: 'openai', apiKey: null },
    };
    expect(() => createProvider(config)).toThrow(LlmNotConfiguredError);
    expect(() => createProvider(config)).toThrow(/задайте PROMPTWIZARD_LLM_API_KEY/);
  });

  it('пустой ключ тоже считается не настроенным', () => {
    const config = { ...DEFAULT_CONFIG, llm: { ...DEFAULT_CONFIG.llm, apiKey: '' } };
    expect(() => createProvider(config)).toThrow(LlmNotConfiguredError);
  });

  it('openai-провайдер создаётся при наличии ключа', () => {
    const config = {
      ...DEFAULT_CONFIG,
      llm: { provider: 'openai', apiKey: 'sk-test', baseUrl: null, model: null },
    };
    const provider = createProvider(config);
    expect(typeof provider.refine).toBe('function');
  });

  it('anthropic-провайдер создаётся при наличии ключа', () => {
    const config = {
      ...DEFAULT_CONFIG,
      llm: { provider: 'anthropic', apiKey: 'sk-test', baseUrl: null, model: null },
    };
    const provider = createProvider(config);
    expect(typeof provider.refine).toBe('function');
  });
});

/* ------------------------------------------------------------------ */
/* postJson: успех, ошибки, ретрай, таймаут                             */
/* ------------------------------------------------------------------ */

describe('postJson — хелпер HTTP с таймаутом и ретраем', () => {
  it('200 → парсинг JSON ответа', async () => {
    const fetchMock = vi.fn().mockResolvedValueOnce(jsonResponse({ ok: true }));
    vi.stubGlobal('fetch', fetchMock);

    const result = await postJson({
      url: 'https://example.com/test',
      serviceName: SERVICE,
      maskedKey: MASKED,
      init: { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' },
    });
    expect(result).toEqual({ ok: true });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('не-JSON при 200 → LlmRequestError «не-JSON ответ»', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValueOnce(new Response('not json', { status: 200 })),
    );

    await expect(
      postJson({
        url: 'https://example.com/test',
        serviceName: SERVICE,
        maskedKey: MASKED,
        init: { method: 'POST' },
      }),
    ).rejects.toThrow(/не-JSON ответ/);
  });

  it('401 → «ключ отклонён», ключ не попадает в сообщение (только маска)', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValueOnce(textResponse('{"error":"unauthorized"}', 401)),
    );

    try {
      await postJson({
        url: 'https://example.com/test',
        serviceName: SERVICE,
        maskedKey: MASKED,
        init: { method: 'POST' },
      });
      throw new Error('должна была броситься ошибка');
    } catch (error) {
      expect(error).toBeInstanceOf(LlmRequestError);
      const message = (error as LlmRequestError).message;
      expect(message).toContain('ключ отклонён');
      expect(message).toContain('HTTP 401');
      expect(message).toContain(MASKED);
      expect(message).not.toContain('sk-test');
      expect(message).not.toContain('unauthorized');
    }
  });

  it('403 → «ключ отклонён»', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValueOnce(textResponse('', 403)));
    await expect(
      postJson({
        url: 'https://example.com/test',
        serviceName: SERVICE,
        maskedKey: MASKED,
        init: { method: 'POST' },
      }),
    ).rejects.toThrow(/ключ отклонён/);
  });

  it('429 → «лимит запросов»', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValueOnce(textResponse('rate limited', 429)));
    await expect(
      postJson({
        url: 'https://example.com/test',
        serviceName: SERVICE,
        maskedKey: MASKED,
        init: { method: 'POST' },
      }),
    ).rejects.toThrow(/лимит запросов/);
  });

  it('400/404/422 → «неверный запрос», включает фрагмент ошибки (обрезанный до 200)', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValueOnce(textResponse('model not found', 404)));
    await expect(
      postJson({
        url: 'https://example.com/test',
        serviceName: SERVICE,
        maskedKey: MASKED,
        init: { method: 'POST' },
      }),
    ).rejects.toThrow(/неверный запрос.*model not found/);
  });

  it('500: первый раз — ретрай, второй раз 500 → LlmRequestError (ровно 1 ретрай)', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(textResponse('server error', 500))
      .mockResolvedValueOnce(textResponse('server error again', 500));
    vi.stubGlobal('fetch', fetchMock);

    await expect(
      postJson({
        url: 'https://example.com/test',
        serviceName: SERVICE,
        maskedKey: MASKED,
        init: { method: 'POST' },
      }),
    ).rejects.toThrow(/HTTP 500/);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('503: первый 503, второй 200 → успех после ретрая', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(textResponse('unavailable', 503))
      .mockResolvedValueOnce(jsonResponse({ choices: [] }));
    vi.stubGlobal('fetch', fetchMock);

    const result = await postJson({
      url: 'https://example.com/test',
      serviceName: SERVICE,
      maskedKey: MASKED,
      init: { method: 'POST' },
    });
    expect(result).toEqual({ choices: [] });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('сетевой error первый раз → ретрай, второй раз ошибка → «не удалось подключиться»', async () => {
    const fetchMock = vi
      .fn()
      .mockRejectedValueOnce(new Error('network down'))
      .mockRejectedValueOnce(new Error('network down'));
    vi.stubGlobal('fetch', fetchMock);

    await expect(
      postJson({
        url: 'https://example.com/test',
        serviceName: SERVICE,
        maskedKey: MASKED,
        init: { method: 'POST' },
      }),
    ).rejects.toThrow(/не удалось подключиться.*network down/);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('сетевая ошибка первый раз → ретрай успешен', async () => {
    const fetchMock = vi
      .fn()
      .mockRejectedValueOnce(new TypeError('fetch failed'))
      .mockResolvedValueOnce(jsonResponse({ data: 1 }));
    vi.stubGlobal('fetch', fetchMock);

    expect(
      await postJson({
        url: 'https://example.com/test',
        serviceName: SERVICE,
        maskedKey: MASKED,
        init: { method: 'POST' },
      }),
    ).toEqual({ data: 1 });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('4xx не ретраится (ровно 1 вызов)', async () => {
    const fetchMock = vi.fn().mockResolvedValueOnce(textResponse('bad request', 400));
    vi.stubGlobal('fetch', fetchMock);

    await expect(
      postJson({
        url: 'https://example.com/test',
        serviceName: SERVICE,
        maskedKey: MASKED,
        init: { method: 'POST' },
      }),
    ).rejects.toThrow(/HTTP 400/);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('прочтение тела ошибки при падении text() не ломает сообщение', async () => {
    const response = {
      ok: false,
      status: 500,
      statusText: 'Internal',
      text: async () => {
        throw new Error('cannot read');
      },
    } as unknown as Response;
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(response));

    await expect(
      postJson({
        url: 'https://example.com/test',
        serviceName: SERVICE,
        maskedKey: MASKED,
        init: { method: 'POST' },
      }),
    ).rejects.toThrow(/HTTP 500/);
  });
});

describe('postJson — таймаут (AbortController)', () => {
  it('сетевой AbortError (имитация таймаута) → ошибка транспорта, ровно 1 ретрай', async () => {
    const fetchMock = vi.fn().mockImplementation(
      () =>
        new Promise((_, reject) => {
          const error = new Error('The operation was aborted');
          error.name = 'AbortError';
          reject(error);
        }),
    );
    vi.stubGlobal('fetch', fetchMock);

    await expect(
      postJson({
        url: 'https://example.com/test',
        serviceName: SERVICE,
        maskedKey: MASKED,
        init: { method: 'POST' },
      }),
    ).rejects.toThrow();
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('константа таймаута = 15000 мс', () => {
    expect(LLM_REQUEST_TIMEOUT_MS).toBe(15_000);
  });
});

/* ------------------------------------------------------------------ */
/* OpenAI-совместимый провайдер                                         */
/* ------------------------------------------------------------------ */

describe('createOpenAiProvider', () => {
  it('POST на /chat/completions с заголовком Authorization: Bearer <ключ>', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        jsonResponse({ choices: [{ message: { content: 'Улучшенный промт' } }] }),
      );
    vi.stubGlobal('fetch', fetchMock);

    const provider = createOpenAiProvider({ apiKey: 'sk-test-key', baseUrl: null, model: null });
    const result = await provider.refine('sys', 'user-prompt');

    expect(result).toBe('Улучшенный промт');
    const call = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(call[0]).toBe('https://api.openai.com/v1/chat/completions');
    expect((call[1].headers as Record<string, string>)['authorization']).toBe('Bearer sk-test-key');
    const body = JSON.parse(call[1].body as string) as { model: string; messages: unknown[] };
    expect(body.model).toBe('gpt-4o-mini');
    expect(body.messages).toEqual([
      { role: 'system', content: 'sys' },
      { role: 'user', content: 'user-prompt' },
    ]);
  });

  it('кастомный baseUrl используется, trailing slash убирается', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse({ choices: [{ message: { content: 'ok' } }] }));
    vi.stubGlobal('fetch', fetchMock);

    const provider = createOpenAiProvider({
      apiKey: 'sk-test',
      baseUrl: 'https://proxy.example.com/v1/',
      model: 'llama-3.1',
    });
    await provider.refine('s', 'u');

    const call = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(call[0]).toBe('https://proxy.example.com/v1/chat/completions');
    const body = JSON.parse(call[1].body as string) as { model: string };
    expect(body.model).toBe('llama-3.1');
  });

  it('пустой content/null/пустая строка → LlmRequestError', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValueOnce(jsonResponse({ choices: [{ message: { content: null } }] })),
    );
    const provider = createOpenAiProvider({ apiKey: 'sk-test', baseUrl: null, model: null });
    await expect(provider.refine('s', 'u')).rejects.toThrow(/пустой ответ|неожиданный формат/);

    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValueOnce(jsonResponse({ choices: [{ message: { content: '   ' } }] })),
    );
    await expect(provider.refine('s', 'u')).rejects.toThrow(/пустой ответ/);
  });

  it('неожиданный формат ответа → LlmRequestError', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValueOnce(jsonResponse({ data: [] })));
    const provider = createOpenAiProvider({ apiKey: 'sk-test', baseUrl: null, model: null });
    await expect(provider.refine('s', 'u')).rejects.toThrow(/неожиданный формат/);
  });
});

/* ------------------------------------------------------------------ */
/* Anthropic провайдер                                                  */
/* ------------------------------------------------------------------ */

describe('createAnthropicProvider', () => {
  it('POST на /v1/messages с заголовками x-api-key и anthropic-version', async () => {
    const fetchMock = vi.fn().mockResolvedValueOnce(
      jsonResponse({
        content: [
          { type: 'thought', text: 'думание' },
          { type: 'text', text: 'Итоговый промт' },
        ],
      }),
    );
    vi.stubGlobal('fetch', fetchMock);

    const provider = createAnthropicProvider({ apiKey: 'sk-ant-test', baseUrl: null, model: null });
    const result = await provider.refine('sys', 'user');

    expect(result).toBe('Итоговый промт');
    const call = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(call[0]).toBe('https://api.anthropic.com/v1/messages');
    const headers = call[1].headers as Record<string, string>;
    expect(headers['x-api-key']).toBe('sk-ant-test');
    expect(headers['anthropic-version']).toBe('2023-06-01');
    const body = JSON.parse(call[1].body as string) as {
      model: string;
      max_tokens: number;
      system: string;
      messages: unknown[];
    };
    expect(body.model).toBe('claude-3-5-sonnet-latest');
    expect(body.max_tokens).toBe(4096);
    expect(body.system).toBe('sys');
    expect(body.messages).toEqual([{ role: 'user', content: 'user' }]);
  });

  it('кастомный baseUrl используется, trailing slash убирается', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse({ content: [{ type: 'text', text: 'ok' }] }));
    vi.stubGlobal('fetch', fetchMock);

    const provider = createAnthropicProvider({
      apiKey: 'sk-ant',
      baseUrl: 'https://proxy.example.com/',
      model: 'claude-custom',
    });
    await provider.refine('s', 'u');

    const call = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(call[0]).toBe('https://proxy.example.com/v1/messages');
    const body = JSON.parse(call[1].body as string) as { model: string };
    expect(body.model).toBe('claude-custom');
  });

  it('пустой content или нет text-блока → LlmRequestError', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValueOnce(jsonResponse({ content: [] })));
    const provider = createAnthropicProvider({ apiKey: 'sk-ant', baseUrl: null, model: null });
    await expect(provider.refine('s', 'u')).rejects.toThrow();

    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValueOnce(jsonResponse({ content: [{ type: 'thought', text: 'x' }] })),
    );
    await expect(provider.refine('s', 'u')).rejects.toThrow(/пустой ответ/);
  });
});

/* ------------------------------------------------------------------ */
/* refineText / системный промпт                                        */
/* ------------------------------------------------------------------ */

describe('refineText и REFINE_SYSTEM_PROMPT', () => {
  it('REFINE_SYSTEM_PROMPT содержит контракт «только итоговый промт» и сохранение намерения', () => {
    expect(REFINE_SYSTEM_PROMPT).toContain('ТОЛЬКО итоговый промт');
    expect(REFINE_SYSTEM_PROMPT).toContain('сохраняй намерение');
  });

  it('buildRefineUserMessage без цели — только промпт', () => {
    expect(buildRefineUserMessage('hello')).toBe('Промт:\nhello');
  });

  it('buildRefineUserMessage с целью — добавляет секцию', () => {
    expect(buildRefineUserMessage('hello', 'make it cinematic')).toBe(
      'Цель доработки: make it cinematic\n\nПромт:\nhello',
    );
  });

  it('buildRefineUserMessage с пустой целью игнорирует её', () => {
    expect(buildRefineUserMessage('hello', '   ')).toBe('Промт:\nhello');
  });

  it('refineText делегирует в provider.refine с системным промптом', async () => {
    const provider = {
      refine: vi.fn().mockResolvedValue('  refined prompt  '),
    };
    const result = await refineText(provider, 'original', 'goal');
    expect(result).toBe('  refined prompt  ');
    expect(provider.refine).toHaveBeenCalledTimes(1);
    expect(provider.refine).toHaveBeenCalledWith(
      REFINE_SYSTEM_PROMPT,
      'Цель доработки: goal\n\nПромт:\noriginal',
    );
  });

  it('ошибка провайдера пробрасывается как есть (LlmRequestError)', async () => {
    const provider = {
      refine: vi.fn().mockRejectedValue(new LlmRequestError('таймаут — сервис не ответил за 15 с')),
    };
    await expect(refineText(provider, 'x')).rejects.toThrow(LlmRequestError);
  });
});
