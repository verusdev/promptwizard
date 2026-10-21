import type { Command } from 'commander';
import chalk from 'chalk';
import { confirm, input, select } from '@inquirer/prompts';
import { PROMPT_TYPES, type PromptType, type Template } from '../lib/schemas.js';
import {
  findTemplate,
  loadRegistry,
  platformsForType,
  type TemplateRegistry,
} from '../lib/templates/registry.js';
import { buildPrompt, type PromptResult } from '../lib/engine/builder.js';
import { copyToClipboard } from '../lib/clipboard.js';
import { writeOutputFile } from '../lib/output.js';
import { ValidationError } from '../lib/engine/errors.js';
import { validateTextSlot } from '../lib/validation/slots.js';

/**
 * Интерактивный мастер (T10): тип → платформа → слоты → предпросмотр →
 * копирование / файл / назад / выход.
 *
 * Не-TTY запуск (пайп, CI) — понятный отказ с подсказкой использовать generate.
 * Ctrl+C / ESC — тихий выход без stack trace (обработка ExitPromptError в cli.ts).
 */

export function registerInteractiveCommand(program: Command): void {
  program
    .command('interactive')
    .description(
      'Интерактивный мастер: от вопросов до готового промта (сохранение/копирование на выбор)',
    )
    .option('-t, --type <type>', 'заранее выбрать тип промта: image | code | text | video | music')
    .option('-p, --platform <platform>', 'заранее выбрать платформу, например midjourney')
    .action(async (rawOptions: Record<string, unknown>) => {
      if (!process.stdin.isTTY || !process.stdout.isTTY) {
        throw new ValidationError(
          'Интерактивному мастеру нужен интерактивный терминал (TTY), а запущен пайп или не-интерактивная консоль. ' +
            'Запустите "promptwizard interactive" в обычной консоли либо соберите промт неинтерактивно: ' +
            'promptwizard generate --type image --platform midjourney --subject "..."',
        );
      }

      const type = parsePreselectedType(rawOptions['type']);
      const platform =
        typeof rawOptions['platform'] === 'string' && rawOptions['platform'].trim() !== ''
          ? rawOptions['platform'].trim()
          : undefined;

      const registry = await loadRegistry();
      await runWizard(registry, { type, platform });
    });
}

/* ------------------------------------------------------------------ */
/* Мастер                                                             */
/* ------------------------------------------------------------------ */

async function runWizard(
  registry: TemplateRegistry,
  preselect: { type?: PromptType; platform?: string },
): Promise<void> {
  // Предустановки --type/--platform валидируются при первом выборе шаблона;
  // после restart («начать заново») работаем без предустановок.
  let allowPreselect = true;

  for (;;) {
    const template = await chooseTemplate(registry, allowPreselect ? preselect : {});
    allowPreselect = false;

    for (;;) {
      const slots = await fillSlots(template);
      const useNegative = await askNegative(template);
      const result = build(template, slots, useNegative);

      const action = await previewMenu(result);
      if (action === 'exit') return;
      if (action === 'back') continue; // изменить ответы, тот же шаблон
      break; // restart — снова тип/платформа
    }
  }
}

/** Шаг 1–2: тип и платформа (с учётом предустановок --type/--platform). */
async function chooseTemplate(
  registry: TemplateRegistry,
  preselect: { type?: PromptType; platform?: string },
): Promise<Template> {
  let type = preselect.type;
  if (type === undefined) {
    type = await select<PromptType>({
      message: 'Тип промта:',
      choices: PROMPT_TYPES.map((value) => ({ value, name: value })),
    });
  }

  if (preselect.platform !== undefined) {
    // Уже провалидировано в action, но повторная проверка безопасна.
    return findTemplate(registry, type, preselect.platform);
  }

  const platforms = platformsForType(registry, type);
  const single = platforms[0];
  if (platforms.length === 1 && single !== undefined) {
    console.error(chalk.dim(`Платформа: ${single.platform} (единственная для типа "${type}")`));
    return findTemplate(registry, type, single.slug);
  }

  const slug = await select<string>({
    message: 'Платформа:',
    choices: platforms.map((entry) => ({
      value: entry.slug,
      name: entry.platform,
      description: `шаблоны: ${entry.templateIds.join(', ')}`,
    })),
  });
  return findTemplate(registry, type, slug);
}

/** Шаг 3: заполнение слотов (input / select / confirm по типу слота). */
async function fillSlots(template: Template): Promise<Record<string, string>> {
  const values: Record<string, string> = {};

  for (const slot of template.slots) {
    const message = slot.description ? `${slot.label} — ${slot.description}` : slot.label;

    if (slot.type === 'enum' && slot.options !== undefined) {
      const value = await select<string>({
        message,
        choices: slot.options.map((option) => ({
          value: option,
          name: option + (slot.default === option ? ' (по умолчанию)' : ''),
        })),
        default: slot.default,
      });
      values[slot.key] = value;
      continue;
    }

    if (slot.type === 'boolean') {
      const value = await confirm({
        message,
        default: slot.default === 'true' || slot.default === 'да',
      });
      values[slot.key] = value ? 'true' : 'false';
      continue;
    }

    const value = await input({
      message: slot.default !== undefined ? `${message} (${slot.default})` : message,
      default: slot.default,
      validate: (raw) => validateTextSlot(slot, raw),
    });
    const trimmed = value.trim();
    if (trimmed !== '') {
      values[slot.key] = trimmed;
    }
  }

  return values;
}

/** Опциональный шаг: негативный блок (только если шаблон умеет негатив). */
async function askNegative(template: Template): Promise<boolean> {
  const hasNegative =
    template.negativeDefault !== undefined ||
    template.rules.some((rule) => rule.when?.flag === 'negative');
  if (!hasNegative) return false;
  return confirm({ message: 'Включить негативный блок шаблона?', default: false });
}

/** Сборка с человекочитаемой ошибкой и возвратом к слотам при сбое. */
function build(
  template: Template,
  slots: Record<string, string>,
  useNegative: boolean,
): PromptResult {
  try {
    return buildPrompt(template, { slots, flags: { negative: useNegative } });
  } catch (error) {
    // Не должно случаться (слоты валидируются при вводе), но падать мастер не должен.
    throw new ValidationError(
      `Не удалось собрать промт: ${error instanceof Error ? error.message : String(error)}`,
      { field: 'слоты' },
    );
  }
}

/** Шаг 4: предпросмотр + меню действий (копировать / файл / назад / заново / выход). */
async function previewMenu(result: PromptResult): Promise<'exit' | 'back' | 'restart'> {
  for (;;) {
    console.log('');
    console.log(chalk.bold('Предпросмотр промта:'));
    console.log(chalk.cyan(result.prompt));
    console.log('');

    const action = await select<'copy' | 'file' | 'back' | 'restart' | 'exit'>({
      message: 'Что сделать?',
      choices: [
        { value: 'copy', name: 'Скопировать в буфер обмена' },
        { value: 'file', name: 'Сохранить в файл' },
        { value: 'back', name: 'Вернуться и изменить ответы' },
        { value: 'restart', name: 'Начать заново (выбрать тип и платформу)' },
        { value: 'exit', name: 'Выйти' },
      ],
    });

    if (action === 'copy') {
      const clipboard = await copyToClipboard(result.prompt);
      if (clipboard.ok) {
        console.error(chalk.green('✓ Промт скопирован в буфер обмена'));
      } else {
        console.error(
          chalk.yellow(`⚠ Не удалось скопировать в буфер обмена: ${clipboard.message}`),
        );
      }
      continue; // остаёмся в меню действий
    }

    if (action === 'file') {
      const target = await input({
        message: 'Путь к файлу (UTF-8, каталоги создаются):',
        validate: (raw) => (raw.trim() === '' ? 'Укажите путь к файлу' : true),
      });
      try {
        await writeOutputFile(target.trim(), `${result.prompt}\n`);
        console.error(chalk.green(`✓ Сохранено в файл: ${target.trim()}`));
      } catch (error) {
        console.error(
          chalk.yellow(
            `⚠ Не удалось сохранить файл: ${error instanceof Error ? error.message : String(error)}`,
          ),
        );
      }
      continue; // остаёмся в меню действий
    }

    return action;
  }
}

/* ------------------------------------------------------------------ */
/* Предустановки из флагов                                            */
/* ------------------------------------------------------------------ */

function parsePreselectedType(raw: unknown): PromptType | undefined {
  if (typeof raw !== 'string' || raw.trim() === '') {
    return undefined;
  }
  const value = raw.trim();
  const parsed = PROMPT_TYPES.find((type) => type === value);
  if (parsed === undefined) {
    throw new ValidationError(
      `Неизвестный тип промта "${value}". Допустимые типы: ${PROMPT_TYPES.join(', ')}.`,
      { field: 'type', allowed: PROMPT_TYPES },
    );
  }
  return parsed;
}
