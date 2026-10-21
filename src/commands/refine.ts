import { readFile } from 'node:fs/promises';
import path from 'node:path';
import type { Command } from 'commander';
import chalk from 'chalk';
import ora from 'ora';
import { z } from 'zod';
import { loadConfig } from '../lib/config.js';
import { createProvider } from '../lib/llm/provider.js';
import { refineText } from '../lib/llm/refine.js';
import { emitText } from '../lib/output.js';
import { readStdinText } from '../lib/stdin.js';
import { LlmRequestError, ValidationError } from '../lib/engine/errors.js';

/**
 * Команда refine (T13): LLM-доработка готового промта.
 * Единственная команда, требующая API-ключ: без ключа — понятная ошибка, exit ≠ 0.
 */

const RefineFlagsSchema = z
  .object({
    text: z.string().trim().min(1).optional(),
    in: z.string().trim().min(1).optional(),
    stdin: z.boolean().default(false),
    goal: z.string().trim().min(1).optional(),
    out: z.string().trim().min(1).optional(),
    copy: z.boolean().default(false),
    json: z.boolean().default(false),
  })
  .strict();

type RefineFlags = z.infer<typeof RefineFlagsSchema>;

export function registerRefineCommand(program: Command): void {
  program
    .command('refine')
    .description('LLM-доработка готового промта (требует API-ключ: PROMPTWIZARD_LLM_API_KEY)')
    .option('--text <text>', 'текст промта прямо в флаге')
    .option('--in <file>', 'прочитать текст промта из файла')
    .option('--stdin', 'прочитать текст промта из stdin (по умолчанию — если задан пайп)')
    .option('--goal <text>', 'цель доработки, например: make it more cinematic')
    .option('--out <file>', 'записать результат в файл (UTF-8)')
    .option('--copy', 'скопировать результат в буфер обмена')
    .option('--json', 'вывести результат машинным форматом JSON')
    .action(async (rawOptions: Record<string, unknown>) => {
      const flags = parseFlags(rawOptions);
      const promptText = await resolveInputText(flags);

      const loaded = await loadConfig();
      // Без ключа — типизированная LlmNotConfiguredError: человекочитаемое сообщение, exit ≠ 0.
      const provider = createProvider(loaded.config);

      const spinner = ora({
        text: 'Доработка промта через LLM...',
        stream: process.stderr,
      }).start();
      let refined: string;
      try {
        refined = await refineText(provider, promptText, flags.goal);
      } catch (error) {
        spinner.stop();
        if (error instanceof LlmRequestError) {
          // Исходный текст не теряется: он у пользователя во вводе (флаг/файл/stdin).
          console.error(
            chalk.yellow(
              '⚠ Доработка не выполнена — исходный текст не изменён и не потерян. ' +
                'Повторите попытку позже либо используйте текст как есть (в т.ч. через generate без --refine).',
            ),
          );
        }
        throw error;
      }
      spinner.succeed('Доработка выполнена');

      await emitText(refined, { out: flags.out, copy: flags.copy, json: flags.json });
    });
}

/* ------------------------------------------------------------------ */
/* Валидация флагов и чтение исходного текста                          */
/* ------------------------------------------------------------------ */

function parseFlags(raw: Record<string, unknown>): RefineFlags {
  const parsed = RefineFlagsSchema.safeParse({
    text: raw['text'],
    in: raw['in'],
    stdin: raw['stdin'] === true,
    goal: raw['goal'],
    out: raw['out'],
    copy: raw['copy'] === true,
    json: raw['json'] === true,
  });
  if (!parsed.success) {
    const details = parsed.error.issues
      .map((issue) => `параметр "${issue.path.join('.') || '?'}": ${issue.message}`)
      .join('; ');
    throw new ValidationError(`Некорректные флаги refine: ${details}`, { field: 'флаги' });
  }

  const flags = parsed.data;
  const sources = [flags.text !== undefined, flags.in !== undefined, flags.stdin].filter(Boolean);
  if (sources.length > 1) {
    throw new ValidationError(
      'Укажите ОДИН источник текста: --text, --in <файл> или stdin (пайп).',
      { field: 'источник' },
    );
  }
  return flags;
}

async function resolveInputText(flags: RefineFlags): Promise<string> {
  if (flags.text !== undefined) {
    return flags.text;
  }

  if (flags.in !== undefined) {
    const resolved = path.resolve(flags.in);
    let content: string;
    try {
      content = await readFile(resolved, 'utf8');
    } catch (error) {
      throw new ValidationError(
        `Не удалось прочитать файл "${resolved}": ${error instanceof Error ? error.message : String(error)}`,
        { field: 'in' },
      );
    }
    const trimmed = content.trim();
    if (trimmed === '') {
      throw new ValidationError(`Файл "${resolved}" пуст — нечего дорабатывать.`, { field: 'in' });
    }
    return trimmed;
  }

  // Источник не задан вовсе (ни --text, ни --in, ни явный --stdin) И stdin пуст/терминал:
  // это ошибка валидации с подсказкой, а не «пустой stdin».
  if (flags.stdin) {
    const piped = await readStdinText();
    if (piped === '') {
      throw new ValidationError('В stdin нет данных — нечего дорабатывать.', { field: 'stdin' });
    }
    return piped;
  }

  // Неявный режим пайпа: stdin не терминал — пробуем прочитать; если данных нет,
  // ниже сработает понятная ошибка «не задан источник».
  if (!process.stdin.isTTY) {
    const piped = await readStdinText();
    if (piped !== '') {
      return piped;
    }
  }

  throw new ValidationError(
    'Не задан текст промта: укажите --text "..." или --in <файл>, либо передайте текст через пайп (stdin).',
    { field: 'источник' },
  );
}
