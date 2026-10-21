// Стабим fetch ДО импорта Ink/yoga, чтобы yoga-layout использовал встроенный base64-WASM
// (иначе tests/setup.ts бросает ошибку при попытке реального fetch).
const globalWithFetch = globalThis as { fetch?: typeof fetch };
if (
  !globalWithFetch.fetch ||
  (globalWithFetch.fetch as unknown as { __pwTestStub?: boolean }).__pwTestStub
) {
  const stub = (() =>
    Promise.reject(new Error('yoga-embedded-fallback'))) as unknown as typeof fetch;
  (stub as unknown as { __pwTestStub?: boolean }).__pwTestStub = true;
  globalWithFetch.fetch = stub;
}

import { cleanup, render } from 'ink-testing-library';
import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import { PROMPT_TYPES } from '../../src/lib/schemas.js';
import { loadRegistry } from '../../src/lib/templates/registry.js';
import type { TemplateRegistry } from '../../src/lib/templates/registry.js';
import { App } from '../../src/lib/tui/app.js';
import { stripAnsi } from '../helpers/ansi.js';

/**
 * MT14 — smoke-тесты TUI на Ink (ink-testing-library).
 *
 * Тесты рендерят корневой компонент App в виртуальном терминале и проверяют
 * базовый флоу: список типов → выбор стрелками → подтверждение Enter'ом.
 *
 * Сеть не используется, файлы не пишутся: рендер идёт в память
 * (ink-testing-library), а реестр читается из локальных JSON-шаблонов.
 */

/** ANSI-последовательности клавиш: вниз, вверх, Enter. */
const KEY_DOWN = '\u001B[B';
const KEY_UP = '\u001B[A';
const KEY_ENTER = '\r';

/**
 * Даёт React/Ink время обработать эффекты (useInput) и перерисовать кадр.
 * Несколько тиков подряд — страховка от гонки между эффектом и вводом.
 */
async function flush(ticks = 4): Promise<void> {
  for (let i = 0; i < ticks; i += 1) {
    await new Promise((resolve) => setTimeout(resolve, 0));
  }
}

/** Текущий кадр терминала без ANSI-последовательностей. */
function frameText(lastFrame: () => string | undefined): string {
  return stripAnsi(lastFrame() ?? '');
}

let registry: TemplateRegistry;

beforeAll(async () => {
  // Реестр читается из src/templates (путь резолвится от import.meta.url).
  registry = await loadRegistry();
});

afterEach(() => {
  // Снимаем активные Ink-инстансы, чтобы не оставались таймеры/хендлеры.
  cleanup();
});

describe('TUI: App — первый кадр', () => {
  it('рендерится без падения и содержит заголовок PromptWizard', async () => {
    const { lastFrame } = render(<App registry={registry} />);
    await flush();

    const frame = frameText(lastFrame);
    expect(frame.length).toBeGreaterThan(0);
    expect(frame).toContain('PromptWizard');
  });

  it('первый кадр содержит список всех типов промтов', async () => {
    const { lastFrame } = render(<App registry={registry} />);
    await flush();

    const frame = frameText(lastFrame);
    expect(frame).toContain('Тип промта');
    for (const type of PROMPT_TYPES) {
      expect(frame).toContain(type);
    }
  });

  it('первый кадр содержит подсказку по клавишам и выделение первого типа', async () => {
    const { lastFrame } = render(<App registry={registry} />);
    await flush();

    const frame = frameText(lastFrame);
    expect(frame).toMatch(/Ctrl\+C/);
    // Выделен первый тип списка (image).
    expect(frame).toMatch(/→\s*image/);
  });
});

describe('TUI: App — навигация стрелками', () => {
  it('стрелка вниз перемещает выделение на следующий тип', async () => {
    const { lastFrame, stdin } = render(<App registry={registry} />);
    await flush();

    expect(frameText(lastFrame)).toMatch(/→\s*image/);

    stdin.write(KEY_DOWN);
    await flush();

    expect(frameText(lastFrame)).toMatch(/→\s*code/);
  });

  it('стрелка вверх возвращает выделение на предыдущий тип (циклический переход)', async () => {
    const { lastFrame, stdin } = render(<App registry={registry} />);
    await flush();

    stdin.write(KEY_UP);
    await flush();

    // С первого элемента вверх переходит на последний (music).
    expect(frameText(lastFrame)).toMatch(/→\s*music/);
  });

  it('несколько нажатий вниз последовательно двигают выделение', async () => {
    const { lastFrame, stdin } = render(<App registry={registry} />);
    await flush();

    stdin.write(KEY_DOWN);
    stdin.write(KEY_DOWN);
    await flush();

    expect(frameText(lastFrame)).toMatch(/→\s*text/);
  });
});

describe('TUI: App — выбор типа (Enter)', () => {
  it('Enter на типе image переходит к шагу выбора платформы', async () => {
    const { lastFrame, stdin } = render(<App registry={registry} />);
    await flush();

    stdin.write(KEY_ENTER);
    await flush();

    const frame = frameText(lastFrame);
    expect(frame).toContain('Выбор платформы');
    expect(frame).toContain('Платформа');
    // Платформы типа image из реального реестра.
    expect(frame).toContain('Midjourney');
    expect(frame).toContain('Stable Diffusion');
    // Список типов больше не показывается.
    expect(frame).not.toContain('Тип промта');
  });

  it('Enter на типе с единственной платформой (code) сразу открывает шаг слотов', async () => {
    const { lastFrame, stdin } = render(<App registry={registry} />);
    await flush();

    // Переходим на "code" (у типа code единственная платформа — "Generic LLM").
    stdin.write(KEY_DOWN);
    await flush();
    stdin.write(KEY_ENTER);
    await flush();

    const frame = frameText(lastFrame);
    expect(frame).toContain('Слоты шаблона');
    expect(frame).toContain('Заполнение слотов');
  });
});
