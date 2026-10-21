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

describe('CLI: refine без ключа (специализированный)', () => {
  it('refine --text "x" → exit != 0, человекочитаемая ошибка, без stack trace', async () => {
    const result = await runCli(['refine', '--text', 'x']);
    expect(result.code).toBe(1);
    expect(result.stderr).toMatch(/Ошибка:/);
    expect(result.stderr).not.toMatch(/node:/);
    expect(hasStackTrace(result.stderr)).toBe(false);
  });

  it('refine через stdin (не-TTY) → корректная ошибка без ключа', async () => {
    const result = await runCli(['refine'], { input: 'test' });
    expect(result.code).toBe(1);
    expect(result.stderr).toMatch(/Ошибка:/);
    expect(hasStackTrace(result.stderr)).toBe(false);
  });

  it('refine --in пустой файл → валидационная ошибка (не LLM)', async () => {
    const spacey = makeSpaceyTmpDir('refine empty ');
    const filePath = path.join(spacey, 'empty.txt');
    writeFileSync(filePath, '   \n', 'utf8');
    tmpDirs.push(spacey);

    const result = await runCli(['refine', '--in', filePath]);
    expect(result.code).toBe(1);
    expect(result.stderr).toMatch(/Ошибка:/);
    expect(result.stderr).toMatch(/пуст/);
    expect(hasStackTrace(result.stderr)).toBe(false);
  });
});
