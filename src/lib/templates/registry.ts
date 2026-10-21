import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  PromptTypeSchema,
  TemplateSchema,
  platformSlug,
  type PromptType,
  type Template,
} from '../schemas.js';
import {
  TemplateLoadError,
  UnknownPlatformError,
  UnknownPromptTypeError,
  ValidationError,
} from '../engine/errors.js';

/**
 * Реестр шаблонов: рекурсивное чтение JSON-базы, валидация Zod, индексы, кеш.
 *
 * Пути резолвятся от import.meta.url (dist/lib/templates → dist/templates),
 * НЕ от process.cwd(): это критично для Windows и глобальной установки CLI.
 */
const MODULE_DIR = path.dirname(fileURLToPath(import.meta.url));
export const TEMPLATES_DIR = path.resolve(MODULE_DIR, '..', '..', 'templates');

export interface TemplateRegistry {
  /** Все шаблоны, отсортированы по типу (в порядке PROMPT_TYPES), затем по id. */
  readonly templates: readonly Template[];
  /** Индекс по id шаблона. */
  readonly byId: ReadonlyMap<string, Template>;
  /** Индекс по типу промта. */
  readonly byType: ReadonlyMap<PromptType, Template[]>;
  /** Индекс по "тип:slug платформы" (slug сравнивается без учёта регистра и разделителей). */
  readonly byTypeAndPlatform: ReadonlyMap<string, Template[]>;
  /** Абсолютный путь к каталогу шаблонов, из которого построен реестр. */
  readonly dir: string;
}

let cache: TemplateRegistry | null = null;

/** Загружает (или возвращает из кеша) реестр шаблонов. */
export async function loadRegistry(options: { refresh?: boolean } = {}): Promise<TemplateRegistry> {
  if (cache !== null && !options.refresh) {
    return cache;
  }

  const files = await collectJsonFiles(TEMPLATES_DIR);
  if (files.length === 0) {
    throw new TemplateLoadError(
      TEMPLATES_DIR,
      'в каталоге не найдено ни одного JSON-файла шаблона. ' +
        'Пересоберите проект: npm run build (ассеты копируются в dist/templates)',
    );
  }

  const templates: Template[] = [];
  const byId = new Map<string, Template>();

  for (const file of files) {
    const template = await loadSingleTemplate(file);
    const duplicate = byId.get(template.id);
    if (duplicate !== undefined) {
      throw new TemplateLoadError(
        file,
        `дублирующийся id шаблона "${template.id}" (уже загружен из ${TEMPLATES_DIR})`,
      );
    }
    byId.set(template.id, template);
    templates.push(template);
  }

  templates.sort((a, b) => {
    const typeDiff =
      PromptTypeSchema.options.indexOf(a.type) - PromptTypeSchema.options.indexOf(b.type);
    if (typeDiff !== 0) return typeDiff;
    return a.id.localeCompare(b.id);
  });

  const byType = new Map<PromptType, Template[]>();
  const byTypeAndPlatform = new Map<string, Template[]>();
  for (const template of templates) {
    const typeList = byType.get(template.type) ?? [];
    typeList.push(template);
    byType.set(template.type, typeList);

    const key = registryKey(template.type, template.platform);
    const platformList = byTypeAndPlatform.get(key) ?? [];
    platformList.push(template);
    byTypeAndPlatform.set(key, platformList);
  }

  cache = {
    templates,
    byId,
    byType,
    byTypeAndPlatform,
    dir: TEMPLATES_DIR,
  };
  return cache;
}

/** Сброс кеша (используется в диагностике/тестах). */
export function clearRegistryCache(): void {
  cache = null;
}

/** Все шаблоны указанного типа; неизвестный тип → UnknownPromptTypeError. */
export function getTemplatesByType(registry: TemplateRegistry, type: string): Template[] {
  const parsed = PromptTypeSchema.safeParse(type);
  if (!parsed.success) {
    throw new UnknownPromptTypeError(type, PromptTypeSchema.options);
  }
  return registry.byType.get(parsed.data) ?? [];
}

/**
 * Находит шаблон по типу и (опционально) платформе.
 * Платформа сравнивается по slug ("Stable Diffusion" ≡ "stable-diffusion") или по id.
 * Без платформы: если среди шаблонов типа ровно одна уникальная платформа — выбирается
 * первый шаблон этой платформы (templates отсортированы по id, выбор детерминирован);
 * иначе ошибка со списком уникальных человекочитаемых имён платформ и подсказкой --platform.
 */
export function findTemplate(
  registry: TemplateRegistry,
  type: string,
  platform?: string,
): Template {
  const templates = getTemplatesByType(registry, type);
  const available = templates.map((t) => platformSlug(t.platform));

  if (platform === undefined) {
    // Уникальные платформы типа (по slug) с человекочитаемыми именами без дублей.
    const uniquePlatforms = collectUniquePlatforms(templates);

    if (uniquePlatforms.length === 1) {
      const first = templates[0];
      if (first !== undefined) {
        return first;
      }
    }

    const names = uniquePlatforms.map((entry) => entry.name);
    throw new ValidationError(
      `Для типа "${type}" доступно несколько платформ: ${names.join(', ')}. Укажите --platform.`,
      {
        field: 'platform',
        allowed: uniquePlatforms.map((entry) => entry.slug),
      },
    );
  }

  const wanted = platformSlug(platform);
  const match = templates.find((t) => platformSlug(t.platform) === wanted || t.id === wanted);
  if (match === undefined) {
    throw new UnknownPlatformError(platform, type, available);
  }
  return match;
}

/** Уникальные платформы типа (по slug) в порядке появления; имена без дублей. */
function collectUniquePlatforms(
  templates: readonly Template[],
): Array<{ name: string; slug: string }> {
  const bySlug = new Map<string, { name: string; slug: string }>();
  for (const template of templates) {
    const slug = platformSlug(template.platform);
    if (!bySlug.has(slug)) {
      bySlug.set(slug, { name: template.platform, slug });
    }
  }
  return [...bySlug.values()];
}

/** Платформы типа: [{ platform, slug, templateIds }]. */
export function platformsForType(
  registry: TemplateRegistry,
  type: PromptType,
): Array<{ platform: string; slug: string; templateIds: string[] }> {
  const templates = registry.byType.get(type) ?? [];
  const bySlug = new Map<string, { platform: string; slug: string; templateIds: string[] }>();
  for (const template of templates) {
    const slug = platformSlug(template.platform);
    const entry = bySlug.get(slug) ?? { platform: template.platform, slug, templateIds: [] };
    entry.templateIds.push(template.id);
    bySlug.set(slug, entry);
  }
  return [...bySlug.values()];
}

/* ------------------------------------------------------------------ */
/* Внутренние помощники                                               */
/* ------------------------------------------------------------------ */

function registryKey(type: string, platform: string): string {
  return `${type}:${platformSlug(platform)}`;
}

async function loadSingleTemplate(file: string): Promise<Template> {
  let raw: string;
  try {
    raw = await readFile(file, 'utf8');
  } catch (error) {
    throw new TemplateLoadError(file, `не удалось прочитать файл (${messageOf(error)})`, {
      cause: error,
    });
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (error) {
    throw new TemplateLoadError(file, `некорректный JSON (${messageOf(error)})`, { cause: error });
  }

  const result = TemplateSchema.safeParse(parsed);
  if (!result.success) {
    throw new TemplateLoadError(file, formatZodIssues(result.error.issues), {
      cause: result.error,
    });
  }
  return result.data;
}

/** Рекурсивно собирает все *.json под каталогом dir (в порядке обхода). */
async function collectJsonFiles(dir: string): Promise<string[]> {
  let entries;
  try {
    entries = await readdir(dir, { withFileTypes: true });
  } catch (error) {
    throw new TemplateLoadError(
      dir,
      `не удалось прочитать каталог шаблонов (${messageOf(error)}). ` +
        'Если CLI запущен из dist — выполните npm run build, чтобы скопировать src/templates в dist/templates',
      { cause: error },
    );
  }

  const files: string[] = [];
  entries.sort((a, b) => a.name.localeCompare(b.name));
  for (const entry of entries) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      files.push(...(await collectJsonFiles(full)));
    } else if (entry.isFile() && entry.name.toLowerCase().endsWith('.json')) {
      files.push(full);
    }
  }
  return files;
}

function formatZodIssues(
  issues: readonly { path: (string | number)[]; message: string }[],
): string {
  return issues
    .map((issue) => {
      const field = issue.path.length > 0 ? issue.path.join('.') : '(корень)';
      return `${field}: ${issue.message}`;
    })
    .join('; ');
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
