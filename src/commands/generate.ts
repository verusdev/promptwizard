import type { Command } from 'commander';
import chalk from 'chalk';
import ora from 'ora';
import {
  GenerateFlagsSchema,
  PromptTypeSchema,
  type PromptType,
  type Template,
} from '../lib/schemas.js';
import { loadRegistry, findTemplate } from '../lib/templates/registry.js';
import { buildPrompt, type BuildInput, type PromptResult } from '../lib/engine/builder.js';
import { emitPrompt } from '../lib/output.js';
import { readStdinText } from '../lib/stdin.js';
import { loadConfig } from '../lib/config.js';
import { createProvider } from '../lib/llm/provider.js';
import { refineText } from '../lib/llm/refine.js';
import { PromptWizardError, ValidationError } from '../lib/engine/errors.js';

/** Сборщик повторяемых флагов: --param a=1 --param b=2 → ['a=1', 'b=2']. */
function collect(value: string, previous: string[]): string[] {
  return [...previous, value];
}

export function registerGenerateCommand(program: Command): void {
  program
    .command('generate')
    .description('Собрать промт по флагам (неинтерактивный режим, работает без ключей и сети)')
    .requiredOption('-t, --type <type>', 'тип промта: image | code | text | video | music')
    .option('-p, --platform <platform>', 'платформа/шаблон, например: midjourney, stable-diffusion')
    .option('-s, --subject <text>', 'сюжет/объект/задача — основной слот шаблона')
    .option('--style <text>', 'стиль (значение слота style, например: cinematic)')
    .option(
      '--param <k=v>',
      'параметр или слот шаблона вида ключ=значение (можно несколько)',
      collect,
      [],
    )
    .option('--negative', 'включить негативный блок шаблона (негативные промты и т.п.)')
    .option('--out <file>', 'записать промт в файл (UTF-8, каталоги создаются)')
    .option('--copy', 'скопировать промт в буфер обмена')
    .option('--json', 'вывести результат машинным форматом JSON')
    .option('--stdin', 'прочитать subject из stdin (для пайпов)')
    .option('--refine', 'доработать промт через LLM (появится в Milestone M4)')
    .action(async (rawOptions: Record<string, unknown>) => {
      const options = parseFlags(rawOptions);

      if (options.stdin && options.subject !== undefined) {
        throw new ValidationError(
          'Флаги --subject и --stdin одновременно не поддерживаются: выберите один источник.',
          { field: 'stdin' },
        );
      }
      if (options.stdin) {
        const piped = await readStdinText();
        if (piped === '') {
          throw new ValidationError('Флаг --stdin задан, но в stdin нет данных.', {
            field: 'stdin',
          });
        }
        options.subject = piped;
      }

      const registry = await loadRegistry();
      const template = findTemplate(registry, options.type, options.platform);
      const input = resolveInput(options, template);
      const result = buildPrompt(template, input);

      // --refine — опциональная LLM-доработка: generate обязан работать без ключа (S1),
      // поэтому любая проблема LLM-слоя деградирует до предупреждения + локального промта.
      const finalResult = options.refine ? await refineWithFallback(result, options.json) : result;

      await emitPrompt(finalResult, {
        out: options.out,
        copy: options.copy,
        json: options.json,
      });
    });
}

/**
 * Пытается доработать собранный промт через LLM (T14).
 * Без ключа / при ошибке сети — предупреждение в stderr и локальный результат, exit 0.
 */
async function refineWithFallback(result: PromptResult, json: boolean): Promise<PromptResult> {
  try {
    const loaded = await loadConfig();
    const provider = createProvider(loaded.config);
    const spinner = ora({ text: 'Доработка промта через LLM...', stream: process.stderr }).start();
    try {
      const refined = await refineText(provider, result.prompt);
      spinner.succeed('Промт доработан LLM');
      return { ...result, prompt: refined };
    } finally {
      spinner.stop();
    }
  } catch (error) {
    // В JSON-режиме предупреждение уходит в stderr — stdout остаётся чистым JSON.
    const hint = error instanceof PromptWizardError ? error.message : String(error);
    console.error(
      chalk.yellow(`⚠ --refine пропущен: ${hint}`) +
        (json ? '' : '\n' + chalk.gray('Показан локальный промт, собранный по шаблонам.')),
    );
    return result;
  }
}

/* ------------------------------------------------------------------ */
/* Валидация флагов                                                   */
/* ------------------------------------------------------------------ */

type ValidFlags = {
  type: PromptType;
  platform?: string;
  subject?: string;
  style?: string;
  params: Record<string, string>;
  negative: boolean;
  out?: string;
  copy: boolean;
  json: boolean;
  stdin: boolean;
  refine: boolean;
};

function parseFlags(raw: Record<string, unknown>): ValidFlags {
  // Неверный --type: понятная ошибка со списком допустимых значений.
  const rawType = raw['type'];
  if (typeof rawType === 'string' && !PromptTypeSchema.options.includes(rawType as PromptType)) {
    throw new ValidationError(
      `Неизвестный тип промта "${rawType}". Допустимые типы: ${PromptTypeSchema.options.join(', ')}.`,
      { field: 'type', allowed: PromptTypeSchema.options },
    );
  }

  // --param: строгая проверка формата "ключ=значение".
  const rawParams = Array.isArray(raw['param']) ? (raw['param'] as unknown[]) : [];
  const params: Record<string, string> = {};
  for (const entry of rawParams) {
    if (typeof entry !== 'string' || !entry.includes('=')) {
      throw new ValidationError(
        `Некорректный --param "${String(entry)}": ожидается формат ключ=значение (например: ar=2:1).`,
        { field: 'param' },
      );
    }
    const index = entry.indexOf('=');
    const key = entry.slice(0, index).trim();
    const value = entry.slice(index + 1).trim();
    if (key === '') {
      throw new ValidationError(`Некорректный --param "${entry}": пустой ключ.`, {
        field: 'param',
      });
    }
    params[key] = value;
  }

  const parsed = GenerateFlagsSchema.safeParse({
    type: raw['type'],
    platform: raw['platform'],
    subject: raw['subject'],
    style: raw['style'],
    params: [],
    negative: raw['negative'] === true,
    out: raw['out'],
    copy: raw['copy'] === true,
    json: raw['json'] === true,
    stdin: raw['stdin'] === true,
    refine: raw['refine'] === true,
  });
  if (!parsed.success) {
    throw new ValidationError(formatFlagErrors(parsed.error.issues), { field: 'флаги' });
  }

  return { ...parsed.data, params };
}

function formatFlagErrors(
  issues: readonly { path: (string | number)[]; message: string }[],
): string {
  return issues
    .map((issue) => `параметр "${issue.path.join('.') || '?'}": ${issue.message}`)
    .join('; ');
}

/* ------------------------------------------------------------------ */
/* Сборка входных данных движка                                       */
/* ------------------------------------------------------------------ */

function resolveInput(flags: ValidFlags, template: Template): BuildInput {
  // --param с ключом слота (например lighting=neon) заполняет слот, остальное — параметры.
  const slotKeys = new Set(template.slots.map((slot) => slot.key));

  const slots: Record<string, string> = {};
  if (flags.subject !== undefined) {
    // --subject — универсальный «сюжет»: слот subject либо первый обязательный слот шаблона.
    const primary =
      template.slots.find((slot) => slot.key === 'subject') ??
      template.slots.find((slot) => slot.required);
    if (primary === undefined) {
      throw new ValidationError(
        `У шаблона "${template.id}" нет слота для --subject. Доступные слоты: ${template.slots.map((s) => s.key).join(', ') || '—'}. Задайте значение через --param.`,
        { field: 'subject', allowed: template.slots.map((s) => s.key) },
      );
    }
    slots[primary.key] = flags.subject;
  }
  if (flags.style !== undefined) {
    const styleSlot = template.slots.find((slot) => slot.key === 'style');
    if (styleSlot === undefined) {
      throw new ValidationError(
        `У шаблона "${template.id}" нет слота style. Доступные слоты: ${template.slots.map((s) => s.key).join(', ') || '—'}.`,
        { field: 'style', allowed: template.slots.map((s) => s.key) },
      );
    }
    slots['style'] = flags.style;
  }

  const params: Record<string, string> = {};
  for (const [key, value] of Object.entries(flags.params)) {
    if (slotKeys.has(key)) {
      slots[key] = value;
    } else {
      params[key] = value;
    }
  }

  return {
    slots,
    params,
    flags: { negative: flags.negative },
  };
}
