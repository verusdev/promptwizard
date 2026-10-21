import { writeFileSync } from 'node:fs';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { hasStackTrace, makeSpaceyTmpDir, removeTmpDir, runCli } from '../helpers/cli.js';

const tmpDirs: string[] = [];

afterEach(() => {
  while (tmpDirs.length > 0) {
    const dir = tmpDirs.pop();
    if (dir !== undefined) {
      removeTmpDir(dir);
    }
  }
});

describe('CLI: list-types (отдельный)', () => {
  it('list-types отображает все 5 типов', async () => {
    const result = await runCli(['list-types']);
    expect(result.code).toBe(0);
    expect(result.stdout).toMatch(/ТИП/);
    expect(result.stdout).toMatch(/image/);
    expect(result.stdout).toMatch(/code/);
    expect(result.stdout).toMatch(/text/);
    expect(result.stdout).toMatch(/video/);
    expect(result.stdout).toMatch(/music/);
    expect(hasStackTrace(result.stderr)).toBe(false);
  });

  it('list-types --json структурирован', async () => {
    const result = await runCli(['list-types', '--json']);
    expect(result.code).toBe(0);
    const parsed = JSON.parse(result.stdout) as { types: Array<{ type: string }> };
    expect(parsed.types.map((t) => t.type).sort()).toEqual([
      'code',
      'image',
      'music',
      'text',
      'video',
    ]);
  });
});

describe('CLI: refine без ключа (отдельный файл)', () => {
  it('refine --text "x" без ключа: ошибка без stack trace, exit != 0', async () => {
    const result = await runCli(['refine', '--text', 'x']);
    expect(result.code).toBe(1);
    expect(result.stderr).toMatch(/Ошибка:/);
    expect(result.stderr).toMatch(/LLM не настроен|PROMPTWIZARD_LLM_API_KEY/);
    expect(hasStackTrace(result.stderr)).toBe(false);
  });

  it('refine --in файл с пробелами в пути, без ключа → ошибка корректная', async () => {
    const spacey = makeSpaceyTmpDir('refine space ');
    const filePath = path.join(spacey, 'prompt file.txt');
    writeFileSync(filePath, 'тестовый промт для доработки', 'utf8');
    tmpDirs.push(spacey);

    const result = await runCli(['refine', '--in', filePath]);
    expect(result.code).toBe(1);
    expect(result.stderr).toMatch(/Ошибка:/);
    expect(hasStackTrace(result.stderr)).toBe(false);
  });

  it('refine (stdin) без ключа → ошибка без stack trace', async () => {
    const result = await runCli(['refine'], { input: 'stdin prompt' });
    expect(result.code).toBe(1);
    expect(result.stderr).toMatch(/Ошибка:/);
    expect(hasStackTrace(result.stderr)).toBe(false);
  });

  it('refine с двумя источниками одновременно → валидационная ошибка', async () => {
    const result = await runCli(['refine', '--text', 'x', '--in', 'nonexistent.txt']);
    expect(result.code).toBe(1);
    expect(result.stderr).toMatch(/ОДИН источник текста/);
    expect(hasStackTrace(result.stderr)).toBe(false);
  });
});
