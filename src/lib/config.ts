import path from 'node:path';
import { cosmiconfig } from 'cosmiconfig';
import { z } from 'zod';
import {
  ConfigFileSchema,
  ConfigSchema,
  DEFAULT_CONFIG,
  LlmProviderSchema,
  type Config,
  type ConfigFile,
} from './schemas.js';
import { ConfigError } from './engine/errors.js';

/**
 * Конфигурация PromptWizard.
 *
 * Источники (по приоритету): env > rc-файл > дефолты.
 * rc-файл ищется через cosmiconfig: .promptwizardrc.json / .promptwizardrc.yaml /
 * .promptwizardrc.yml / ключ "promptwizard" в package.json (поиск вверх от cwd).
 */

export type ConfigOrigin = 'env' | 'file' | 'default';

export interface LoadedConfig {
  /** Эффективная конфигурация после слияния всех источников. */
  config: Config;
  /** Абсолютный путь к найденному rc-файлу (null — не найден). */
  file: string | null;
  /** Происхождение каждого значения: 'llm.provider' → 'env' | 'file' | 'default'. */
  origins: Record<string, ConfigOrigin>;
}

/** Маппинг env-переменных на поля конфига (§3 PLAN.md). */
export const ENV_MAPPING = {
  PROMPTWIZARD_LLM_API_KEY: 'llm.apiKey',
  PROMPTWIZARD_LLM_PROVIDER: 'llm.provider',
  PROMPTWIZARD_LLM_BASE_URL: 'llm.baseUrl',
  PROMPTWIZARD_LLM_MODEL: 'llm.model',
} as const;

/** Ключи, которые поддерживает `config set`. */
export const SETTABLE_KEYS = ['llm.provider', 'llm.apiKey', 'llm.baseUrl', 'llm.model'] as const;

const SEARCH_PLACES = [
  '.promptwizardrc.json',
  '.promptwizardrc.yaml',
  '.promptwizardrc.yml',
  'package.json',
];

function createExplorer() {
  return cosmiconfig('promptwizard', { searchPlaces: SEARCH_PLACES });
}

/** Поиск с нормализацией синтаксических ошибок rc-файла в ConfigError с путём. */
async function safeSearch(cwd: string | undefined) {
  try {
    return await createExplorer().search(cwd);
  } catch (error) {
    const err = error as { name?: string; filepath?: string; message?: string };
    const isParseError =
      err.name === 'JSONError' ||
      err.name === 'JSONSyntaxError' ||
      err.name === 'SyntaxError' ||
      err.name === 'YAMLParseError' ||
      err.name === 'YAMLException';
    if (isParseError) {
      const kind = err.name === 'YAMLParseError' || err.name === 'YAMLException' ? 'YAML' : 'JSON';
      throw new ConfigError(
        `некорректный синтаксис ${kind}: ${err.message ?? 'ошибка разбора'}`,
        err.filepath ?? null,
        { cause: error },
      );
    }
    throw error;
  }
}

/** Загружает и валидирует конфигурацию (env > файл > дефолты). */
export async function loadConfig(options: { cwd?: string } = {}): Promise<LoadedConfig> {
  const search = await safeSearch(options.cwd);

  let fileConfig: ConfigFile | null = null;
  let file: string | null = null;
  if (search !== null && !search.isEmpty) {
    file = search.filepath ?? null;
    const parsed = ConfigFileSchema.safeParse(search.config);
    if (!parsed.success) {
      throw new ConfigError(`невалидная конфигурация: ${formatIssues(parsed.error.issues)}`, file, {
        cause: parsed.error,
      });
    }
    fileConfig = parsed.data;
  }

  const origins: Record<string, ConfigOrigin> = {};
  const llm = {
    provider: resolveField(
      'llm.provider',
      readEnv('PROMPTWIZARD_LLM_PROVIDER', LlmProviderSchema),
      fileConfig?.llm?.provider ?? null,
      DEFAULT_CONFIG.llm.provider,
      origins,
    ),
    apiKey: resolveField(
      'llm.apiKey',
      readEnvString('PROMPTWIZARD_LLM_API_KEY'),
      fileConfig?.llm?.apiKey ?? null,
      DEFAULT_CONFIG.llm.apiKey,
      origins,
    ),
    baseUrl: resolveField(
      'llm.baseUrl',
      readEnvString('PROMPTWIZARD_LLM_BASE_URL'),
      fileConfig?.llm?.baseUrl ?? null,
      DEFAULT_CONFIG.llm.baseUrl,
      origins,
    ),
    model: resolveField(
      'llm.model',
      readEnvString('PROMPTWIZARD_LLM_MODEL'),
      fileConfig?.llm?.model ?? null,
      DEFAULT_CONFIG.llm.model,
      origins,
    ),
  };

  return { config: ConfigSchema.parse({ llm }), file, origins };
}

/** Маскирует секрет для вывода: "sk-abcdef" → "sk-***". */
export function maskSecret(value: string | null | undefined): string {
  if (value === null || value === undefined || value === '') {
    return '—';
  }
  if (value.length <= 4) {
    return '****';
  }
  return `${value.slice(0, 3)}***`;
}

/** Читает rc-файл как «сырой» объект (для команды config set/init). */
export async function readRawConfigFile(
  cwd: string = process.cwd(),
): Promise<{ filepath: string; config: Record<string, unknown> } | null> {
  const search = await safeSearch(cwd);
  if (search === null || search.isEmpty || search.filepath === undefined) {
    return null;
  }
  if (typeof search.config !== 'object' || search.config === null || Array.isArray(search.config)) {
    throw new ConfigError(
      'некорректный формат файла: корень конфигурации должен быть JSON-объектом (не массивом и не примитивом)',
      search.filepath,
    );
  }
  return { filepath: search.filepath, config: search.config as Record<string, unknown> };
}

/** Абсолютный путь rc-файла в указанном каталоге (куда пишут config set/init). */
export function rcFilePath(cwd: string = process.cwd()): string {
  return path.join(cwd, '.promptwizardrc.json');
}

/** Валидирует значение, задаваемое через `config set <key> <value>`. */
export function validateConfigValue(key: string, value: string): void {
  switch (key) {
    case 'llm.provider': {
      const parsed = LlmProviderSchema.safeParse(value);
      if (!parsed.success) {
        throw new ConfigError(
          `недопустимый провайдер "${value}". Допустимо: ${LlmProviderSchema.options.join(', ')}`,
        );
      }
      return;
    }
    case 'llm.baseUrl': {
      if (!z.string().url().safeParse(value).success) {
        throw new ConfigError(`llm.baseUrl должен быть корректным URL, получено "${value}"`);
      }
      return;
    }
    case 'llm.apiKey':
    case 'llm.model': {
      if (value.trim() === '') {
        throw new ConfigError(`значение ${key} не может быть пустым`);
      }
      return;
    }
    default:
      throw new ConfigError(
        `неизвестный ключ конфигурации "${key}". Допустимые ключи: ${SETTABLE_KEYS.join(', ')}`,
      );
  }
}

/** Устанавливает значение по точечному пути в объекте (мутирует target). */
export function setByPath(target: Record<string, unknown>, dottedKey: string, value: string): void {
  const parts = dottedKey.split('.');
  let node: Record<string, unknown> = target;
  for (const part of parts.slice(0, -1)) {
    const next = node[part];
    if (typeof next !== 'object' || next === null || Array.isArray(next)) {
      node[part] = {};
    }
    node = node[part] as Record<string, unknown>;
  }
  const last = parts[parts.length - 1];
  if (last !== undefined) {
    node[last] = value;
  }
}

/* ------------------------------------------------------------------ */
/* Внутренние помощники                                               */
/* ------------------------------------------------------------------ */

function resolveField<T extends string | null>(
  key: string,
  envValue: T | null,
  fileValue: T | null,
  defaultValue: T,
  origins: Record<string, ConfigOrigin>,
): T {
  if (envValue !== null) {
    origins[key] = 'env';
    return envValue;
  }
  if (fileValue !== null) {
    origins[key] = 'file';
    return fileValue;
  }
  origins[key] = 'default';
  return defaultValue;
}

function readEnvString(name: string): string | null {
  const value = process.env[name];
  return value !== undefined && value.trim() !== '' ? value.trim() : null;
}

function readEnv<T extends string>(name: string, schema: z.ZodEnum<[T, ...T[]]>): T | null {
  const raw = readEnvString(name);
  if (raw === null) {
    return null;
  }
  const parsed = schema.safeParse(raw);
  if (!parsed.success) {
    throw new ConfigError(
      `невалидное значение ${name}="${raw}". Допустимо: ${schema.options.join(', ')}`,
    );
  }
  return parsed.data;
}

function formatIssues(issues: readonly { path: (string | number)[]; message: string }[]): string {
  return issues
    .map((issue) => `${issue.path.join('.') || '(корень)'}: ${issue.message}`)
    .join('; ');
}
