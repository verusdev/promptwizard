import { describe, expect, it, vi } from 'vitest';
import { LlmRequestError } from '../../src/lib/engine/errors.js';
import { createAnthropicProvider } from '../../src/lib/llm/anthropic.js';
import { postJson } from '../../src/lib/llm/provider.js';

const SERVICE = 'Тестовый API';
const MASKED = 'sk-***';

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

function textResponse(body: string, status: number): Response {
  return new Response(body, { status });
}

describe('createAnthropicProvider (доп. тесты)', () => {
  it('склеивает несколько text-блоков в один результат', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValueOnce(
        jsonResponse({
          content: [
            { type: 'text', text: 'первая часть ' },
            { type: 'thought', text: 'игнорируем' },
            { type: 'text', text: 'вторая часть' },
          ],
        }),
      ),
    );
    const provider = createAnthropicProvider({ apiKey: 'sk-ant', baseUrl: null, model: null });
    expect(await provider.refine('s', 'u')).toBe('первая часть вторая часть');
  });

  it('трекирует заголовки запроса', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse({ content: [{ type: 'text', text: 'ok' }] }));
    vi.stubGlobal('fetch', fetchMock);
    const provider = createAnthropicProvider({ apiKey: 'sk-ant-x', baseUrl: null, model: null });
    await provider.refine('system', 'user');
    const call = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(call[1].method).toBe('POST');
    expect((call[1].headers as Record<string, string>)['content-type']).toBe('application/json');
  });
});

describe('postJson — защита от утечки ключа в деталях', () => {
  it('ключ не включается в readErrorDetail (деталь берётся из тела, но мы маскируем в httpStatusError)', async () => {
    vi.stubGlobal(
      'fetch',
      vi
        .fn()
        .mockResolvedValueOnce(
          textResponse('{"error":{"message":"invalid api key sk-REAL-SECRET"}}', 401),
        ),
    );
    try {
      await postJson({
        url: 'https://example.com/test',
        serviceName: 'Anthropic API',
        maskedKey: MASKED,
        init: { method: 'POST' },
      });
      throw new Error('должна была быть ошибка');
    } catch (error) {
      expect(error).toBeInstanceOf(LlmRequestError);
      const message = (error as LlmRequestError).message;
      expect(message).toContain(MASKED);
      // Тело ошибки может содержать детали API — ключ не должен утечь.
      expect(message).not.toContain('sk-REAL-SECRET');
    }
  });

  it('все LlmRequestError — человекочитаемые (PromptWizardError)', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValueOnce(textResponse('', 500)));
    try {
      await postJson({
        url: 'https://example.com/test',
        serviceName: SERVICE,
        maskedKey: MASKED,
        init: { method: 'POST' },
      });
    } catch (error) {
      expect((error as Error).message).not.toMatch(/at \S+\(/);
    }
  });
});
