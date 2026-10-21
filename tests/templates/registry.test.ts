import { mkdtempSync, rmSync } from 'node:fs';
import type * as FsPromises from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  TemplateLoadError,
  UnknownPlatformError,
  UnknownPromptTypeError,
  ValidationError,
} from '../../src/lib/engine/errors.js';
import { PROMPT_TYPES } from '../../src/lib/schemas.js';
import {
  TEMPLATES_DIR,
  clearRegistryCache,
  findTemplate,
  getTemplatesByType,
  loadRegistry,
  platformsForType,
  type TemplateRegistry,
} from '../../src/lib/templates/registry.js';
import { makeTemplate } from '../helpers/fixtures.js';

/* ------------------------------------------------------------------ */
/* Мок node:fs/promises: по умолчанию — реальная ФС, но можно          */
/* подставить сбой/битые данные для TEMPLATES_DIR (не трогая src/).    */
/* ------------------------------------------------------------------ */

interface FsControl {
  readdirImpl: ((dir: string) => Promise<unknown[]>) | null;
  readFileImpl: ((file: string) => Promise<string>) | null;
}

const fsControl = vi.hoisted<FsControl>(() => ({
  readdirImpl: null,
  readFileImpl: null,
}));

vi.mock('node:fs/promises', async (importOriginal) => {
  const actual = await importOriginal<typeof FsPromises>();
  return {
    ...actual,
    readdir: (dir: unknown, opts?: unknown): Promise<unknown[]> =>
      fsControl.readdirImpl !== null
        ? fsControl.readdirImpl(dir as string)
        : (actual.readdir as (d: unknown, o?: unknown) => Promise<unknown[]>)(dir, opts),
    readFile: (file: unknown, opts?: unknown): Promise<string> =>
      fsControl.readFileImpl !== null
        ? fsControl.readFileImpl(file as string)
        : (actual.readFile as (f: unknown, o?: unknown) => Promise<string>)(file, opts),
  };
});

function fakeEntry(name: string, kind: 'file' | 'dir'): unknown {
  return { name, isDirectory: () => kind === 'dir', isFile: () => kind === 'file' };
}

beforeEach(() => {
  clearRegistryCache();
});

afterEach(() => {
  fsControl.readdirImpl = null;
  fsControl.readFileImpl = null;
  clearRegistryCache();
});

/* ------------------------------------------------------------------ */
/* Реальная база шаблонов                                              */
/* ------------------------------------------------------------------ */

describe('loadRegistry — реальная база src/templates', () => {
  it('загружает все шаблоны, все 5 типов присутствуют', async () => {
    const registry = await loadRegistry();
    expect(registry.templates.length).toBeGreaterThanOrEqual(11);
    for (const type of PROMPT_TYPES) {
      expect(registry.byType.get(type)?.length).toBeGreaterThanOrEqual(1);
    }
  });

  it('пути резолвятся от import.meta.url, а не от process.cwd', async () => {
    const previousCwd = process.cwd();
    const spaceyDir = mkdtempSync(path.join(tmpdir(), 'prompt wizard registry '));
    try {
      process.chdir(spaceyDir);
      const registry = await loadRegistry({ refresh: true });
      expect(registry.dir).toBe(TEMPLATES_DIR);
      expect(path.isAbsolute(registry.dir)).toBe(true);
      expect(registry.templates.length).toBeGreaterThanOrEqual(11);
    } finally {
      process.chdir(previousCwd);
      rmSync(spaceyDir, { recursive: true, force: true });
    }
  });

  it('строит индексы: byId, byType, byTypeAndPlatform', async () => {
    const registry = await loadRegistry();
    expect(registry.byId.size).toBe(registry.templates.length);
    expect(registry.byTypeAndPlatform.get('image:midjourney')?.[0]?.id).toBe('midjourney');
    expect(registry.byTypeAndPlatform.get('image:stable-diffusion')?.[0]?.id).toBe(
      'stable-diffusion',
    );
    // Slug без пробелов: "Generic LLM" → "generic-llm".
    expect(registry.byTypeAndPlatform.get('music:generic-llm')?.[0]?.id).toBe('generic');
  });

  it('шаблоны отсортированы: сначала по типу (в порядке PROMPT_TYPES), затем по id', async () => {
    const registry = await loadRegistry();
    const typeIndexes = registry.templates.map((t) => PROMPT_TYPES.indexOf(t.type));
    expect([...typeIndexes].sort((a, b) => a - b)).toEqual(typeIndexes);
  });

  it('каждый шаблон валиден схемой, id уникальны, есть примеры, нет TODO', async () => {
    const registry = await loadRegistry();
    const ids = new Set<string>();
    for (const template of registry.templates) {
      expect(template.id).not.toBe('');
      expect(template.examples.length).toBeGreaterThanOrEqual(1);
      expect(ids.has(template.id)).toBe(false);
      ids.add(template.id);
    }
    expect(JSON.stringify(registry.templates)).not.toContain('TODO');
  });

  it('каталог шаблонов абсолютный и заканчивается на "templates"', async () => {
    const registry = await loadRegistry();
    expect(registry.dir.endsWith('templates')).toBe(true);
  });
});

describe('кеш реестра', () => {
  it('повторный вызов возвращает тот же объект из кеша', async () => {
    const first = await loadRegistry();
    const second = await loadRegistry();
    expect(second).toBe(first);
  });

  it('refresh: true перечитывает базу (новый объект)', async () => {
    const first = await loadRegistry();
    const refreshed = await loadRegistry({ refresh: true });
    expect(refreshed).not.toBe(first);
    expect(refreshed.templates.length).toBe(first.templates.length);
  });

  it('clearRegistryCache сбрасывает кеш', async () => {
    const first = await loadRegistry();
    clearRegistryCache();
    const second = await loadRegistry();
    expect(second).not.toBe(first);
  });
});

/* ------------------------------------------------------------------ */
/* findTemplate / getTemplatesByType / platformsForType                */
/* ------------------------------------------------------------------ */

describe('findTemplate', () => {
  it('находит по slug платформы, без учёта регистра и разделителей', async () => {
    const registry = await loadRegistry();
    expect(findTemplate(registry, 'image', 'midjourney').id).toBe('midjourney');
    expect(findTemplate(registry, 'image', 'MIDJOURNEY').id).toBe('midjourney');
    expect(findTemplate(registry, 'image', 'Stable Diffusion').id).toBe('stable-diffusion');
    expect(findTemplate(registry, 'image', 'stable diffusion').id).toBe('stable-diffusion');
  });

  it('находит по id шаблона, если id не совпадает с slug платформы', async () => {
    const registry = await loadRegistry();
    // Платформа "Generic LLM" → slug "generic-llm"; id "generic" достижим только по id.
    expect(findTemplate(registry, 'music', 'generic').id).toBe('generic');
    expect(findTemplate(registry, 'text', 'rewrite').id).toBe('rewrite');
  });

  it('без платформы при нескольких шаблонах — ошибка со списком и подсказкой --platform', async () => {
    const registry = await loadRegistry();
    expect.assertions(3);
    try {
      findTemplate(registry, 'image');
    } catch (error) {
      expect(error).toBeInstanceOf(ValidationError);
      expect((error as ValidationError).message).toMatch(/несколько платформ/);
      expect((error as ValidationError).message).toContain('--platform');
    }
  });

  it('без платформы при ровно одном шаблоне типа — возвращает его', async () => {
    const only = makeTemplate({ id: 'solo', type: 'music', platform: 'Solo' });
    const registry: TemplateRegistry = {
      templates: [only],
      byId: new Map([[only.id, only]]),
      byType: new Map([['music', [only]]]),
      byTypeAndPlatform: new Map(),
      dir: TEMPLATES_DIR,
    };
    expect(findTemplate(registry, 'music')).toBe(only);
  });

  it('неизвестная платформа → UnknownPlatformError с доступными платформами', async () => {
    const registry = await loadRegistry();
    expect.assertions(4);
    try {
      findTemplate(registry, 'image', 'pixel-art');
    } catch (error) {
      expect(error).toBeInstanceOf(UnknownPlatformError);
      const platformError = error as UnknownPlatformError;
      expect(platformError.field).toBe('platform');
      expect(platformError.message).toContain('pixel-art');
      expect(platformError.allowed).toContain('stable-diffusion');
    }
  });

  it('неизвестный тип → UnknownPromptTypeError с перечислением типов', async () => {
    const registry = await loadRegistry();
    expect.assertions(3);
    try {
      findTemplate(registry, 'audio');
    } catch (error) {
      expect(error).toBeInstanceOf(UnknownPromptTypeError);
      expect((error as UnknownPromptTypeError).field).toBe('type');
      expect((error as UnknownPromptTypeError).message).toContain('image');
    }
  });
});

describe('getTemplatesByType и platformsForType', () => {
  it('getTemplatesByType возвращает шаблоны типа', async () => {
    const registry = await loadRegistry();
    expect(getTemplatesByType(registry, 'image').length).toBe(3);
  });

  it('getTemplatesByType: неизвестный тип → UnknownPromptTypeError', async () => {
    const registry = await loadRegistry();
    expect(() => getTemplatesByType(registry, 'audio')).toThrow(UnknownPromptTypeError);
  });

  it('platformsForType группирует по slug платформы', async () => {
    const registry = await loadRegistry();
    const platforms = platformsForType(registry, 'image');
    const slugs = platforms.map((p) => p.slug).sort();
    // platformSlug("DALL-E") → "dall-e"; проверяем фактический результат
    expect(slugs).toEqual(['dall-e', 'midjourney', 'stable-diffusion']);
    for (const entry of platforms) {
      expect(entry.templateIds.length).toBeGreaterThanOrEqual(1);
    }
  });
});

/* ------------------------------------------------------------------ */
/* Ошибки загрузки (мок ФС): src/ не трогаем, сбои подставляем         */
/* ------------------------------------------------------------------ */

describe('loadRegistry — ошибки чтения и валидации', () => {
  it('пустой каталог шаблонов → TemplateLoadError с путём и подсказкой о сборке', async () => {
    fsControl.readdirImpl = async () => [];
    await expect(loadRegistry()).rejects.toThrow(TemplateLoadError);
    await expect(loadRegistry({ refresh: true })).rejects.toThrow(/npm run build/);
  });

  it('readdir бросает ошибку (каталог недоступен) → TemplateLoadError с путём каталога', async () => {
    fsControl.readdirImpl = async () => {
      throw new Error('EPERM: permission denied');
    };
    await expect(loadRegistry()).rejects.toThrow(/не удалось прочитать каталог шаблонов/);
    await expect(loadRegistry({ refresh: true })).rejects.toThrow(TEMPLATES_DIR);
  });

  it('не-JSON файлы в каталоге игнорируются, JSON — загружаются', async () => {
    fsControl.readdirImpl = async (dir) => {
      if (dir === TEMPLATES_DIR) {
        return [
          fakeEntry('README.md', 'file'),
          fakeEntry('ok.json', 'file'),
          fakeEntry('nested', 'dir'),
        ];
      }
      return [fakeEntry('inner.json', 'file')];
    };
    fsControl.readFileImpl = async (file) =>
      file.endsWith('ok.json')
        ? JSON.stringify(makeTemplate({ id: 'ok-template' }))
        : JSON.stringify(makeTemplate({ id: 'inner-template', type: 'text' }));

    const registry = await loadRegistry();
    expect([...registry.byId.keys()].sort()).toEqual(['inner-template', 'ok-template']);
  });

  it('битый JSON → TemplateLoadError с точным путём к файлу', async () => {
    fsControl.readdirImpl = async () => [fakeEntry('broken.json', 'file')];
    fsControl.readFileImpl = async () => '{ это не JSON';
    await expect(loadRegistry()).rejects.toThrow(/некорректный JSON/);
    await expect(loadRegistry({ refresh: true })).rejects.toThrow(/broken\.json/);
  });

  it('файл не читается (ошибка ФС) → TemplateLoadError с сообщением причины', async () => {
    fsControl.readdirImpl = async () => [fakeEntry('locked.json', 'file')];
    fsControl.readFileImpl = async () => {
      throw new Error('EBUSY: file locked');
    };
    await expect(loadRegistry()).rejects.toThrow(/не удалось прочитать файл.*EBUSY/);
  });

  it('строка вместо Error при чтении → сообщение не ломается', async () => {
    fsControl.readdirImpl = async () => [fakeEntry('weird.json', 'file')];
    fsControl.readFileImpl = async () => {
      throw 'boom';
    };
    await expect(loadRegistry()).rejects.toThrow(/boom/);
  });

  it('невалидная схема (корень) → TemplateLoadError с "(корень)"', async () => {
    fsControl.readdirImpl = async () => [fakeEntry('not-object.json', 'file')];
    fsControl.readFileImpl = async () => '"просто строка"';
    await expect(loadRegistry()).rejects.toThrow(/\(корень\)/);
  });

  it('невалидная схема (поле) → TemplateLoadError с именем поля', async () => {
    fsControl.readdirImpl = async () => [fakeEntry('invalid.json', 'file')];
    fsControl.readFileImpl = async () =>
      JSON.stringify({ id: 'x', type: 'image', name: 'x', description: 'x', template: 'x' });
    // Нет обязательного platform → ошибка по пути platform.
    await expect(loadRegistry()).rejects.toThrow(/platform/);
  });

  it('дублирующийся id → TemplateLoadError', async () => {
    fsControl.readdirImpl = async () => [
      fakeEntry('a-first.json', 'file'),
      fakeEntry('b-second.json', 'file'),
    ];
    fsControl.readFileImpl = async (file) =>
      JSON.stringify(
        makeTemplate({
          id: 'duplicate-id',
          type: file.endsWith('a-first.json') ? 'image' : 'text',
        }),
      );
    await expect(loadRegistry()).rejects.toThrow(/дублирующийся id шаблона "duplicate-id"/);
  });
});
