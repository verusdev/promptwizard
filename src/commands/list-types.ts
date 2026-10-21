import type { Command } from 'commander';
import chalk from 'chalk';
import { PromptTypeSchema, type PromptType } from '../lib/schemas.js';
import {
  loadRegistry,
  platformsForType,
  type TemplateRegistry,
} from '../lib/templates/registry.js';

export function registerListTypesCommand(program: Command): void {
  program
    .command('list-types')
    .description('Показать доступные типы промтов и платформы')
    .option('--json', 'вывести каталог машинным форматом JSON')
    .action(async (options: { json?: boolean }) => {
      const registry = await loadRegistry();
      const catalog = buildCatalog(registry);

      if (options.json === true) {
        process.stdout.write(`${JSON.stringify(catalog, null, 2)}\n`);
        return;
      }

      console.log(chalk.bold('Типы промтов PromptWizard:'));
      console.log('');
      const typeWidth = Math.max(4, ...catalog.types.map((entry) => entry.type.length));
      console.log(chalk.bold(`${'ТИП'.padEnd(typeWidth)}  ${'ПЛАТФОРМЫ'.padEnd(30)}  ШАБЛОНОВ`));
      for (const entry of catalog.types) {
        const platforms = entry.platforms.map((p) => p.platform).join(', ');
        console.log(
          `${chalk.cyan(entry.type.padEnd(typeWidth))}  ${platforms.padEnd(30)}  ${entry.templateCount}`,
        );
      }
      console.log('');
      console.log(chalk.gray('Подробнее: promptwizard list-templates <тип>'));
    });
}

interface TypeCatalogEntry {
  type: PromptType;
  platforms: Array<{ platform: string; slug: string; templateIds: string[] }>;
  templateCount: number;
}

function buildCatalog(registry: TemplateRegistry): { types: TypeCatalogEntry[] } {
  return {
    types: PromptTypeSchema.options.map((type) => {
      const platforms = platformsForType(registry, type);
      return {
        type,
        platforms,
        templateCount: platforms.reduce((sum, p) => sum + p.templateIds.length, 0),
      };
    }),
  };
}
