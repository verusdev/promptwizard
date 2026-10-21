import type { Command } from 'commander';
import chalk from 'chalk';
import { PromptTypeSchema } from '../lib/schemas.js';
import {
  loadRegistry,
  getTemplatesByType,
  platformsForType,
  type TemplateRegistry,
} from '../lib/templates/registry.js';
import { UnknownPromptTypeError } from '../lib/engine/errors.js';
import type { Template } from '../lib/schemas.js';

export function registerListTemplatesCommand(program: Command): void {
  program
    .command('list-templates')
    .description('Показать шаблоны указанного типа (или все, если тип не задан)')
    .argument('[type]', 'тип промта: image | code | text | video | music')
    .option('--json', 'вывести каталог машинным форматом JSON')
    .action(async (type: string | undefined, options: { json?: boolean }) => {
      const registry = await loadRegistry();

      let templates: Template[];
      if (type === undefined) {
        templates = [...registry.templates];
      } else {
        if (!PromptTypeSchema.options.includes(type as (typeof PromptTypeSchema.options)[number])) {
          throw new UnknownPromptTypeError(type, PromptTypeSchema.options);
        }
        templates = getTemplatesByType(registry, type);
      }

      if (options.json === true) {
        process.stdout.write(`${JSON.stringify(templates, null, 2)}\n`);
        return;
      }

      if (templates.length === 0) {
        console.log(chalk.yellow('Шаблоны не найдены.'));
        return;
      }

      printTable(registry, templates, type);
    });
}

function printTable(
  registry: TemplateRegistry,
  templates: Template[],
  type: string | undefined,
): void {
  const first = templates[0];
  if (type === undefined || first === undefined) {
    // Группировка по типам при выводе всей базы (или пустого списка).
    let currentType: Template['type'] | null = null;
    let printedAny = false;
    for (const template of templates) {
      if (template.type !== currentType) {
        if (printedAny) console.log('');
        currentType = template.type;
        console.log(chalk.bold.underline(`${currentType}:`));
        printedAny = true;
      }
      printRows([template]);
    }
  } else {
    const platforms = platformsForType(registry, first.type);
    if (platforms.length > 1) {
      console.log(chalk.gray(`Платформы: ${platforms.map((p) => p.slug).join(', ')}`));
      console.log('');
    }
    printRows(templates);
  }

  console.log('');
  console.log(chalk.gray('Детали шаблона: promptwizard list-templates <тип> --json'));
}

function printRows(templates: Template[]): void {
  const idWidth = Math.max(2, ...templates.map((t) => t.id.length));
  const nameWidth = Math.max(4, ...templates.map((t) => t.name.length));
  console.log(
    chalk.bold(`${'ID'.padEnd(idWidth)}  ${'НАЗВАНИЕ'.padEnd(nameWidth)}  ОПИСАНИЕ · СЛОТЫ`),
  );
  for (const template of templates) {
    const slots = template.slots
      .map((slot) => (slot.required ? `${slot.key}*` : slot.key))
      .join(', ');
    const description = `${template.description} · слоты: ${slots || '—'}`;
    console.log(
      `${chalk.cyan(template.id.padEnd(idWidth))}  ${template.name.padEnd(nameWidth)}  ${description}`,
    );
  }
}
