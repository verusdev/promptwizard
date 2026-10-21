import { writeFile } from 'node:fs/promises';
import type { Command } from 'commander';
import chalk from 'chalk';
import {
  loadConfig,
  maskSecret,
  readRawConfigFile,
  rcFilePath,
  setByPath,
  validateConfigValue,
  ENV_MAPPING,
  SETTABLE_KEYS,
  type LoadedConfig,
} from '../lib/config.js';
import { ConfigError } from '../lib/engine/errors.js';

export function registerConfigCommand(program: Command): void {
  const config = program.command('config').description('Работа с конфигурацией: show | set | init');

  config
    .command('show')
    .description('Показать эффективную конфигурацию (API-ключ маскируется)')
    .option('--json', 'вывести машинным форматом JSON')
    .action(async (options: { json?: boolean }) => {
      const loaded = await loadConfig();
      if (options.json === true) {
        process.stdout.write(`${JSON.stringify(renderForJson(loaded), null, 2)}\n`);
        return;
      }
      printHuman(loaded);
    });

  config
    .command('set')
    .description(`Записать значение в .promptwizardrc.json (ключи: ${SETTABLE_KEYS.join(', ')})`)
    .argument('<key>', 'точечный ключ, например llm.provider')
    .argument('<value>', 'значение, например anthropic')
    .action(async (key: string, value: string) => {
      validateConfigValue(key, value);

      const existing = await readRawConfigFile();
      const target =
        existing !== null && existing.filepath.endsWith('.promptwizardrc.json')
          ? { filepath: existing.filepath, config: structuredClone(existing.config) }
          : { filepath: rcFilePath(), config: {} as Record<string, unknown> };

      setByPath(target.config, key, value);
      await writeFile(target.filepath, `${JSON.stringify(target.config, null, 2)}\n`, 'utf8');
      console.error(chalk.green(`✓ ${key} записан в ${target.filepath}`));
      if (existing !== null && !existing.filepath.endsWith('.promptwizardrc.json')) {
        console.error(
          chalk.gray(
            `  (использовался другой файл конфигурации: ${existing.filepath} — значение добавлено в .promptwizardrc.json, он имеет приоритет при поиске в этом каталоге)`,
          ),
        );
      }
    });

  config
    .command('init')
    .description('Создать .promptwizardrc.json в текущем каталоге')
    .option('--force', 'перезаписать существующий файл')
    .action(async (options: { force?: boolean }) => {
      const filePath = rcFilePath();
      if (options.force !== true) {
        // readRawConfigFile бросит понятную ConfigError с путём, если файл битый.
        const existing = await readRawConfigFile();
        if (existing !== null && existing.filepath === filePath) {
          throw new ConfigError(
            `файл ${filePath} уже существует. Используйте config set или флаг --force.`,
            filePath,
          );
        }
      }
      const initial = { llm: { provider: 'openai' } };
      await writeFile(filePath, `${JSON.stringify(initial, null, 2)}\n`, 'utf8');
      console.error(chalk.green(`✓ Создан ${filePath}`));
      console.error(chalk.gray('  Заполните его: config set llm.apiKey sk-... или через env.'));
    });
}

/* ------------------------------------------------------------------ */
/* Вывод                                                               */
/* ------------------------------------------------------------------ */

const FIELD_ROWS: Array<{ key: string; label: string }> = [
  { key: 'llm.provider', label: 'Провайдер LLM' },
  { key: 'llm.apiKey', label: 'API-ключ' },
  { key: 'llm.baseUrl', label: 'Base URL' },
  { key: 'llm.model', label: 'Модель' },
];

function printHuman(loaded: LoadedConfig): void {
  console.log(chalk.bold('PromptWizard — конфигурация'));
  console.log(
    loaded.file !== null
      ? chalk.gray(`Файл: ${loaded.file}`)
      : chalk.gray(
          'Файл: не найден (.promptwizardrc.* / ключ promptwizard в package.json) — используются дефолты',
        ),
  );
  console.log('');

  for (const row of FIELD_ROWS) {
    const value = readPath(loaded, row.key);
    const shown = row.key === 'llm.apiKey' ? maskSecret(value) : (value ?? '—');
    const origin = describeOrigin(loaded, row.key);
    console.log(`${chalk.cyan(row.key.padEnd(14))} = ${shown.padEnd(20)} ${chalk.gray(origin)}`);
  }

  console.log('');
  console.log(chalk.gray('Env-переменные:'));
  for (const [env, key] of Object.entries(ENV_MAPPING)) {
    console.log(chalk.gray(`  ${env} → ${key}`));
  }
}

function renderForJson(loaded: LoadedConfig): Record<string, unknown> {
  return {
    file: loaded.file,
    origins: loaded.origins,
    llm: {
      provider: loaded.config.llm.provider,
      apiKey: maskSecret(loaded.config.llm.apiKey),
      baseUrl: loaded.config.llm.baseUrl,
      model: loaded.config.llm.model,
    },
  };
}

function readPath(loaded: LoadedConfig, key: string): string | null {
  if (key === 'llm.provider') return loaded.config.llm.provider;
  if (key === 'llm.apiKey') return loaded.config.llm.apiKey;
  if (key === 'llm.baseUrl') return loaded.config.llm.baseUrl;
  if (key === 'llm.model') return loaded.config.llm.model;
  return null;
}

function describeOrigin(loaded: LoadedConfig, key: string): string {
  const origin = loaded.origins[key];
  if (origin === 'env') {
    const envName = Object.entries(ENV_MAPPING).find(([, k]) => k === key)?.[0];
    return envName !== undefined ? `(env: ${envName})` : '(переменная окружения)';
  }
  if (origin === 'file') return '(rc-файл)';
  return '(дефолт)';
}
