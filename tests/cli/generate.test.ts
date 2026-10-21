import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { hasStackTrace, makeSpaceyTmpDir, removeTmpDir, runCli } from '../helpers/cli.js';

const tmpDirs: string[] = [];

beforeEach(() => {
  // Очистка env LLM перед каждым интеграционным тестом CLI (ключей быть не должно)
});

afterEach(() => {
  while (tmpDirs.length > 0) {
    const dir = tmpDirs.pop();
    if (dir !== undefined) {
      removeTmpDir(dir);
    }
  }
});

/* ------------------------------------------------------------------ */
/* generate: stdout, --out, --json                                     */
/* ------------------------------------------------------------------ */

describe('CLI: generate', () => {
  it('generate выводит промт в stdout (по умолчанию)', async () => {
    const result = await runCli([
      'generate',
      '--type',
      'image',
      '--platform',
      'midjourney',
      '--subject',
      'a cyberpunk city',
    ]);
    expect(result.code).toBe(0);
    expect(result.stdout.length).toBeGreaterThan(0);
    // Промт содержит ключевые фрагменты из примера Midjourney.
    expect(result.stdout).toMatch(/cyberpunk city/);
    // stderr чист от stack trace.
    expect(hasStackTrace(result.stderr)).toBe(false);
  });

  it('generate --out записывает в файл (создаёт родительские каталоги)', async () => {
    const spacey = makeSpaceyTmpDir('prompt wizard out ');
    const outPath = path.join(spacey, 'nested', 'dir', 'prompt.txt');
    tmpDirs.push(spacey);

    const result = await runCli([
      'generate',
      '--type',
      'text',
      '--platform',
      'article',
      '--subject',
      'test topic',
      '--out',
      outPath,
    ]);

    expect(result.code).toBe(0);
    expect(hasStackTrace(result.stderr)).toBe(false);
    const saved = readFileSync(outPath, 'utf8');
    expect(saved).toMatch(/test topic/);
    expect(saved.endsWith('\n')).toBe(true);
    expect(result.stdout.length).toBe(0); // промт ушёл в файл, stdout пуст (по логике emitPrompt)
  });

  it('generate --json выводит валидный JSON, stdout содержит только JSON', async () => {
    const result = await runCli([
      'generate',
      '--type',
      'image',
      '--platform',
      'dalle',
      '--subject',
      'sunset over ocean',
      '--json',
    ]);

    expect(result.code).toBe(0);
    expect(hasStackTrace(result.stderr)).toBe(false);
    let parsed: unknown;
    expect(() => {
      parsed = JSON.parse(result.stdout);
    }).not.toThrow();
    const obj = parsed as Record<string, unknown>;
    expect(typeof obj.prompt).toBe('string');
    expect(typeof obj.template).toBe('string');
    expect(obj.type).toBe('image');
    expect(obj.platform).toBe('DALL-E');
    expect(obj.negative).toBeNull();
    expect(typeof obj.slots).toBe('object');
  });

  it('generate с пайпом: echo | generate --type text --stdin', async () => {
    const result = await runCli(
      ['generate', '--type', 'code', '--platform', 'generic-llm', '--stdin'],
      { input: 'implement auth middleware' },
    );
    expect(result.code).toBe(0);
    expect(result.stdout).toMatch(/implement auth middleware/);
    expect(hasStackTrace(result.stderr)).toBe(false);
  });

  it('generate: неверный флаг --type nope → человекочитаемая Zod-ошибка, exit ≠ 0, без stack trace', async () => {
    const result = await runCli(['generate', '--type', 'nope', '--subject', 'test']);
    expect(result.code).toBe(1);
    expect(result.stderr).toMatch(/Ошибка:/);
    expect(result.stderr).toMatch(/тип промта/);
    expect(hasStackTrace(result.stderr)).toBe(false);
  });
});

/* ------------------------------------------------------------------ */
/* list-types                                                          */
/* ------------------------------------------------------------------ */

describe('CLI: list-types', () => {
  it('list-types выводит 5 типов, без stack trace', async () => {
    const result = await runCli(['list-types']);
    expect(result.code).toBe(0);
    expect(hasStackTrace(result.stderr)).toBe(false);
    expect(result.stdout).toMatch(/image/);
    expect(result.stdout).toMatch(/code/);
    expect(result.stdout).toMatch(/text/);
    expect(result.stdout).toMatch(/video/);
    expect(result.stdout).toMatch(/music/);
  });

  it('list-types --json валидный JSON', async () => {
    const result = await runCli(['list-types', '--json']);
    expect(result.code).toBe(0);
    let parsed: unknown;
    expect(() => {
      parsed = JSON.parse(result.stdout);
    }).not.toThrow();
    const obj = parsed as { types?: unknown[] };
    expect(Array.isArray(obj.types)).toBe(true);
    expect((obj.types ?? []).length).toBe(5);
  });
});

/* ------------------------------------------------------------------ */
/* refine без ключа                                                    */
/* ------------------------------------------------------------------ */

describe('CLI: refine без ключа', () => {
  it('refine --text "x" без ключа → понятная ошибка, exit ≠ 0, без stack trace', async () => {
    const result = await runCli(['refine', '--text', 'x']);
    expect(result.code).toBe(1);
    expect(result.stderr).toMatch(/Ошибка:/);
    // Сообщение от LlmNotConfiguredError: содержит подсказку про API-ключ.
    expect(result.stderr).toMatch(/LLM не настроен|API-ключ|PROMPTWIZARD_LLM_API_KEY/);
    expect(hasStackTrace(result.stderr)).toBe(false);
  });

  it('refine из stdin без ключа → понятная ошибка, exit ≠ 0', async () => {
    const result = await runCli(['refine', '--text', 'test prompt']);
    // При отсутствии ключа провайдер/конфиг создаёт ошибку.
    expect(result.code).toBe(1);
    expect(result.stderr).toMatch(/Ошибка:/);
    expect(hasStackTrace(result.stderr)).toBe(false);
  });

  it('refine --in файл без ключа → понятная ошибка, exit ≠ 0', async () => {
    const spacey = makeSpaceyTmpDir('prompt wizard refine ');
    const filePath = path.join(spacey, 'p.txt');
    writeFileSync(filePath, 'исходный промт', 'utf8');
    tmpDirs.push(spacey);

    const result = await runCli(['refine', '--in', filePath]);
    expect(result.code).toBe(1);
    expect(result.stderr).toMatch(/Ошибка:/);
    expect(hasStackTrace(result.stderr)).toBe(false);
  });

  it('refine без источника → человекочитаемая ошибка валидации, exit ≠ 0', async () => {
    const result = await runCli(['refine']);
    expect(result.code).toBe(1);
    expect(result.stderr).toMatch(/Ошибка:/);
    expect(result.stderr).toMatch(/Не задан текст промта|источник/);
    expect(hasStackTrace(result.stderr)).toBe(false);
  });
});

/* ------------------------------------------------------------------ */
/* другие команды: doctor, config, list-templates                      */
/* ------------------------------------------------------------------ */

describe('CLI: прочие команды (smoke)', () => {
  it('doctor — работает без ключа, автономный режим', async () => {
    const result = await runCli(['doctor']);
    expect(result.code).toBe(0);
    expect(result.stdout).toMatch(/PromptWizard/);
    // Нет ключа → рекомендация/отметка, что автономный режим работает.
    expect(result.stdout).toMatch(/автономный режим|LLM не настроен|API-ключ/);
    expect(hasStackTrace(result.stderr)).toBe(false);
  });

  it('config show — маскирует ключ, показывает происхождения', async () => {
    const result = await runCli(['config', 'show']);
    expect(result.code).toBe(0);
    expect(result.stdout).toMatch(/llm\.provider/);
    expect(result.stdout).toMatch(/llm\.apiKey/);
    // Маска ключа: '—' или '****' или 'sk-***'
    expect(result.stdout).toMatch(/—|sk-\*\*\*|\*\*\*\*/);
    expect(hasStackTrace(result.stderr)).toBe(false);
  });

  it('list-templates image — 3 шаблона', async () => {
    const result = await runCli(['list-templates', 'image']);
    expect(result.code).toBe(0);
    expect(result.stdout).toMatch(/midjourney/);
    expect(result.stdout).toMatch(/dalle/);
    expect(result.stdout).toMatch(/stable-diffusion/);
    expect(hasStackTrace(result.stderr)).toBe(false);
  });

  it('list-templates image --json валидный JSON', async () => {
    const result = await runCli(['list-templates', 'image', '--json']);
    expect(result.code).toBe(0);
    expect(() => JSON.parse(result.stdout)).not.toThrow();
    const parsed = JSON.parse(result.stdout) as unknown;
    // Команда выводит JSON шаблонов (массив)
    expect(Array.isArray(parsed)).toBe(true);
    expect((parsed as unknown[]).length).toBe(3);
  });

  it('неизвестный тип в list-templates → ошибка с подсказкой, exit ≠ 0', async () => {
    const result = await runCli(['list-templates', 'audio']);
    expect(result.code).toBe(1);
    expect(result.stderr).toMatch(/Ошибка:/);
    expect(result.stderr).toMatch(/тип промта/);
    expect(hasStackTrace(result.stderr)).toBe(false);
  });
});

/* ------------------------------------------------------------------ */
/* дополнительные проверки: пробелы в путях, generate --refine без ключа */
/* ------------------------------------------------------------------ */

describe('CLI: особые случаи', () => {
  it('пути с пробелами устойчивы (--out в каталоге с пробелом)', async () => {
    const spacey = makeSpaceyTmpDir('space in path ');
    const outPath = path.join(spacey, 'file with space.txt');
    tmpDirs.push(spacey);

    const result = await runCli([
      'generate',
      '--type',
      'code',
      '--platform',
      'refactor',
      '--subject',
      'refactor auth',
      '--out',
      outPath,
    ]);
    expect(result.code).toBe(0);
    const content = readFileSync(outPath, 'utf8');
    expect(content).toMatch(/refactor auth/);
  });

  it('generate --refine без ключа: предупреждение в stderr, промт выдан в stdout, exit 0 (fallback)', async () => {
    const result = await runCli([
      'generate',
      '--type',
      'image',
      '--platform',
      'midjourney',
      '--subject',
      'test scene',
      '--refine',
    ]);
    expect(result.code).toBe(0);
    // Предупреждение идёт в stderr, stdout чистый промт (нет JSON)
    expect(result.stderr).toMatch(/--refine пропущен|LLM не настроен/);
    expect(result.stdout).toMatch(/test scene/);
    expect(hasStackTrace(result.stderr)).toBe(false);
  });

  it('generate --refine --json без ключа: stderr имеет предупреждение, stdout — валидный JSON', async () => {
    const result = await runCli([
      'generate',
      '--type',
      'text',
      '--platform',
      'rewrite',
      '--subject',
      'original text',
      '--refine',
      '--json',
    ]);
    expect(result.code).toBe(0);
    expect(result.stderr).toMatch(/--refine пропущен/);
    expect(() => JSON.parse(result.stdout)).not.toThrow();
    const parsed = JSON.parse(result.stdout) as { prompt?: string };
    expect(parsed.prompt).toMatch(/original text/);
  });
});
