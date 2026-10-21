import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { ConfigError, PromptWizardError } from '../../src/lib/engine/errors.js';
import {
  ENV_MAPPING,
  SETTABLE_KEYS,
  loadConfig,
  maskSecret,
  readRawConfigFile,
  rcFilePath,
  setByPath,
  validateConfigValue,
} from '../../src/lib/config.js';

const ENV_KEYS = Object.keys(ENV_MAPPING) as Array<keyof typeof ENV_MAPPING>;

let savedEnv: Record<string, string | undefined> = {};
const tmpDirs: string[] = [];

/** Временный каталог с пробелом в пути; удаляется в afterEach. */
function makeTmpDir(): string {
  const dir = mkdtempSync(path.join(tmpdir(), 'prompt wizard config '));
  tmpDirs.push(dir);
  return dir;
}

function writeRc(dir: string, content: string): string {
  const file = path.join(dir, '.promptwizardrc.json');
  writeFileSync(file, content, 'utf8');
  return file;
}

beforeEach(() => {
  savedEnv = {};
  for (const key of ENV_KEYS) {
    savedEnv[key] = process.env[key];
    delete process.env[key];
  }
});

afterEach(() => {
  for (const key of ENV_KEYS) {
    const value = savedEnv[key];
    if (value === undefined) {
      delete process.env[key];
    } else {
      process.env[key] = value;
    }
  }
  while (tmpDirs.length > 0) {
    const dir = tmpDirs.pop();
    if (dir !== undefined) {
      rmSync(dir, { recursive: true, force: true });
    }
  }
});

/* ------------------------------------------------------------------ */
/* Дефолты                                                             */
/* ------------------------------------------------------------------ */

describe('loadConfig — дефолты', () => {
  it('без rc-файла и env возвращаются дефолты с происхождением default', async () => {
    const dir = makeTmpDir();
    const loaded = await loadConfig({ cwd: dir });

    expect(loaded.file).toBeNull();
    expect(loaded.config.llm.provider).toBe('openai');
    expect(loaded.config.llm.apiKey).toBeNull();
    expect(loaded.config.llm.baseUrl).toBeNull();
    expect(loaded.config.llm.model).toBeNull();
    expect(loaded.origins).toEqual({
      'llm.provider': 'default',
      'llm.apiKey': 'default',
      'llm.baseUrl': 'default',
      'llm.model': 'default',
    });
  });
});

/* ------------------------------------------------------------------ */
/* rc-файл                                                             */
/* ------------------------------------------------------------------ */

describe('loadConfig — rc-файл', () => {
  it('.promptwizardrc.json читается, происхождение — file', async () => {
    const dir = makeTmpDir();
    writeRc(dir, JSON.stringify({ llm: { provider: 'anthropic', model: 'claude-x' } }));

    const loaded = await loadConfig({ cwd: dir });
    expect(loaded.file).toBe(path.join(dir, '.promptwizardrc.json'));
    expect(loaded.config.llm.provider).toBe('anthropic');
    expect(loaded.config.llm.model).toBe('claude-x');
    expect(loaded.origins['llm.provider']).toBe('file');
    expect(loaded.origins['llm.model']).toBe('file');
  });

  it('.promptwizardrc.yaml читается', async () => {
    const dir = makeTmpDir();
    writeFileSync(path.join(dir, '.promptwizardrc.yaml'), 'llm:\n  provider: anthropic\n', 'utf8');

    const loaded = await loadConfig({ cwd: dir });
    expect(loaded.config.llm.provider).toBe('anthropic');
    expect(loaded.origins['llm.provider']).toBe('file');
  });

  it('ключ "promptwizard" в package.json читается', async () => {
    const dir = makeTmpDir();
    writeFileSync(
      path.join(dir, 'package.json'),
      JSON.stringify({ name: 'x', promptwizard: { llm: { model: 'gpt-from-pkg' } } }),
      'utf8',
    );

    const loaded = await loadConfig({ cwd: dir });
    expect(loaded.config.llm.model).toBe('gpt-from-pkg');
    expect(loaded.origins['llm.model']).toBe('file');
  });
});

/* ------------------------------------------------------------------ */
/* Приоритет: env > файл > дефолты                                     */
/* ------------------------------------------------------------------ */

describe('loadConfig — приоритет источников', () => {
  it('env перекрывает rc-файл', async () => {
    const dir = makeTmpDir();
    writeRc(dir, JSON.stringify({ llm: { provider: 'anthropic', model: 'file-model' } }));
    process.env['PROMPTWIZARD_LLM_PROVIDER'] = 'openai';

    const loaded = await loadConfig({ cwd: dir });
    expect(loaded.config.llm.provider).toBe('openai');
    expect(loaded.origins['llm.provider']).toBe('env');
    // Не тронутые поля остаются из файла.
    expect(loaded.config.llm.model).toBe('file-model');
    expect(loaded.origins['llm.model']).toBe('file');
  });

  it('окружение с пустым/пробельным значением считается незаданным (файл побеждает)', async () => {
    const dir = makeTmpDir();
    writeRc(dir, JSON.stringify({ llm: { provider: 'anthropic' } }));
    process.env['PROMPTWIZARD_LLM_PROVIDER'] = '   ';

    const loaded = await loadConfig({ cwd: dir });
    expect(loaded.config.llm.provider).toBe('anthropic');
    expect(loaded.origins['llm.provider']).toBe('file');
  });

  it('каждое поле резолвится независимо: env для model, файл для baseUrl, дефолт для ключа', async () => {
    const dir = makeTmpDir();
    writeRc(dir, JSON.stringify({ llm: { baseUrl: 'https://file.example.com/v1' } }));
    process.env['PROMPTWIZARD_LLM_MODEL'] = 'env-model';

    const loaded = await loadConfig({ cwd: dir });
    expect(loaded.origins['llm.model']).toBe('env');
    expect(loaded.config.llm.model).toBe('env-model');
    expect(loaded.origins['llm.baseUrl']).toBe('file');
    expect(loaded.origins['llm.apiKey']).toBe('default');
    expect(loaded.config.llm.apiKey).toBeNull();
  });
});

/* ------------------------------------------------------------------ */
/* Ошибки                                                              */
/* ------------------------------------------------------------------ */

describe('loadConfig — ошибки', () => {
  it('битый JSON в rc-файле → ConfigError с путём к файлу', async () => {
    const dir = makeTmpDir();
    const file = writeRc(dir, '{ "llm": ');

    expect.assertions(3);
    try {
      await loadConfig({ cwd: dir });
    } catch (error) {
      expect(error).toBeInstanceOf(ConfigError);
      const configError = error as ConfigError;
      expect(configError.message).toMatch(/некорректный синтаксис JSON/);
      expect(configError.file).toBe(file);
    }
  });

  it('битый YAML в rc-файле → ConfigError с путём к файлу', async () => {
    const dir = makeTmpDir();
    const file = path.join(dir, '.promptwizardrc.yaml');
    writeFileSync(file, 'llm: [unclosed\n', 'utf8');

    expect.assertions(3);
    try {
      await loadConfig({ cwd: dir });
    } catch (error) {
      expect(error).toBeInstanceOf(ConfigError);
      expect((error as ConfigError).message).toMatch(/некорректный синтаксис (JSON|YAML)/);
      expect((error as ConfigError).file).toBe(file);
    }
  });

  it('невалидный rc (неизвестное поле) → ConfigError с путём', async () => {
    const dir = makeTmpDir();
    const file = writeRc(dir, JSON.stringify({ llm: { provider: 'openai' }, extra: true }));

    expect.assertions(3);
    try {
      await loadConfig({ cwd: dir });
    } catch (error) {
      expect(error).toBeInstanceOf(ConfigError);
      const configError = error as ConfigError;
      expect(configError.message).toMatch(/невалидная конфигурация/);
      expect(configError.file).toBe(file);
    }
  });

  it('rc-файл-массив → ConfigError (ожидается объект)', async () => {
    const dir = makeTmpDir();
    writeRc(dir, '[1, 2, 3]');
    await expect(loadConfig({ cwd: dir })).rejects.toThrow(/невалидная конфигурация/);
  });

  it('невалидный env-провайдер → ConfigError с именем переменной и допустимыми значениями', async () => {
    const dir = makeTmpDir();
    process.env['PROMPTWIZARD_LLM_PROVIDER'] = 'gemini';

    expect.assertions(3);
    try {
      await loadConfig({ cwd: dir });
    } catch (error) {
      expect(error).toBeInstanceOf(ConfigError);
      const configError = error as ConfigError;
      expect(configError.message).toContain('PROMPTWIZARD_LLM_PROVIDER');
      expect(configError.message).toContain('openai, anthropic');
    }
  });

  it('все ошибки конфигурации — PromptWizardError (CLI покажет message без трейса)', async () => {
    const dir = makeTmpDir();
    writeRc(dir, 'не json');
    await expect(loadConfig({ cwd: dir })).rejects.toBeInstanceOf(PromptWizardError);
  });
});

/* ------------------------------------------------------------------ */
/* Маскирование ключа                                                  */
/* ------------------------------------------------------------------ */

describe('maskSecret — ключ не утекает в вывод', () => {
  it('null/undefined/пустая строка → прочерк', () => {
    expect(maskSecret(null)).toBe('—');
    expect(maskSecret(undefined)).toBe('—');
    expect(maskSecret('')).toBe('—');
  });

  it('короткие значения полностью заменяются звёздами', () => {
    expect(maskSecret('abc')).toBe('****');
    expect(maskSecret('abcd')).toBe('****');
  });

  it('длинный ключ маскируется до "префикс***" — хвост не виден', () => {
    const key = 'sk-live-abcdefSECREThusky42';
    const masked = maskSecret(key);
    expect(masked).toBe('sk-***');
    expect(masked).not.toContain('abcdef');
    expect(masked).not.toContain('SECRET');
    expect(key.startsWith(masked.replace('***', ''))).toBe(true);
  });

  it('env-ключ виден в конфиге, но маска не содержит его хвоста', async () => {
    const dir = makeTmpDir();
    const secret = 'sk-env-super-secret-tail-98765';
    process.env['PROMPTWIZARD_LLM_API_KEY'] = secret;

    const loaded = await loadConfig({ cwd: dir });
    expect(loaded.origins['llm.apiKey']).toBe('env');
    const masked = maskSecret(loaded.config.llm.apiKey);
    expect(masked).toBe('sk-***');
    expect(masked).not.toContain('secret');
  });
});

/* ------------------------------------------------------------------ */
/* readRawConfigFile / setByPath / validateConfigValue / rcFilePath    */
/* ------------------------------------------------------------------ */

describe('readRawConfigFile', () => {
  it('rc-файл отсутствует → null', async () => {
    const dir = makeTmpDir();
    expect(await readRawConfigFile(dir)).toBeNull();
  });

  it('возвращает сырой объект без валидации схемы (лишние поля сохраняются)', async () => {
    const dir = makeTmpDir();
    writeRc(dir, JSON.stringify({ llm: { provider: 'anthropic' }, extra: 1 }));

    const raw = await readRawConfigFile(dir);
    expect(raw).not.toBeNull();
    expect(raw?.filepath).toBe(path.join(dir, '.promptwizardrc.json'));
    expect(raw?.config).toEqual({ llm: { provider: 'anthropic' }, extra: 1 });
  });

  it('не-объект (массив) → ConfigError «должен быть JSON-объектом»', async () => {
    const dir = makeTmpDir();
    writeRc(dir, '[1]');
    await expect(readRawConfigFile(dir)).rejects.toThrow(/должен быть.*объект/);
  });
});

describe('setByPath', () => {
  it('создаёт вложенные объекта по точечному пути', () => {
    const target: Record<string, unknown> = {};
    setByPath(target, 'llm.model', 'gpt-x');
    expect(target).toEqual({ llm: { model: 'gpt-x' } });
  });

  it('перезаписывает промежуточный узел, если он не объект', () => {
    const target: Record<string, unknown> = { llm: 'строка' };
    setByPath(target, 'llm.model', 'gpt-x');
    expect(target).toEqual({ llm: { model: 'gpt-x' } });
  });

  it('существующее значение обновляется без потери соседних полей', () => {
    const target: Record<string, unknown> = { llm: { provider: 'openai', model: 'old' } };
    setByPath(target, 'llm.model', 'new');
    expect(target).toEqual({ llm: { provider: 'openai', model: 'new' } });
  });
});

describe('validateConfigValue', () => {
  it('допустимые значения проходят', () => {
    expect(() => validateConfigValue('llm.provider', 'anthropic')).not.toThrow();
    expect(() => validateConfigValue('llm.baseUrl', 'https://api.example.com/v1')).not.toThrow();
    expect(() => validateConfigValue('llm.apiKey', 'sk-x')).not.toThrow();
    expect(() => validateConfigValue('llm.model', 'gpt-4o')).not.toThrow();
  });

  it('недопустимый провайдер → ConfigError со списком', () => {
    expect(() => validateConfigValue('llm.provider', 'gemini')).toThrow(
      /недопустимый провайдер "gemini".*openai, anthropic/,
    );
  });

  it('некорректный URL → ConfigError', () => {
    expect(() => validateConfigValue('llm.baseUrl', 'не url')).toThrow(/корректным URL/);
  });

  it('пустой ключ/модель → ConfigError', () => {
    expect(() => validateConfigValue('llm.apiKey', '  ')).toThrow(/не может быть пустым/);
    expect(() => validateConfigValue('llm.model', '')).toThrow(/не может быть пустым/);
  });

  it('неизвестный ключ → ConfigError со списком допустимых', () => {
    expect(() => validateConfigValue('llm.secret', 'x')).toThrow(
      new RegExp(`Допустимые ключи: ${SETTABLE_KEYS.join(', ')}`),
    );
  });
});

describe('rcFilePath', () => {
  it('возвращает .promptwizardrc.json в указанном каталоге', () => {
    const dir = makeTmpDir();
    expect(rcFilePath(dir)).toBe(path.join(dir, '.promptwizardrc.json'));
  });
});
