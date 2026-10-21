import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import chalk from 'chalk';
import { Command } from 'commander';
import { registerGenerateCommand } from './commands/generate.js';
import { registerInteractiveCommand } from './commands/interactive.js';
import { registerListTypesCommand } from './commands/list-types.js';
import { registerListTemplatesCommand } from './commands/list-templates.js';
import { registerRefineCommand } from './commands/refine.js';
import { registerConfigCommand } from './commands/config.js';
import { registerDoctorCommand } from './commands/doctor.js';
import { registerTuiCommand } from './commands/tui.js';
import { PromptWizardError } from './lib/engine/errors.js';

/** Версия из package.json (путь резолвится от расположения модуля, не от cwd). */
function readVersion(): string {
  const pkgPath = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', 'package.json');
  try {
    const pkg = JSON.parse(readFileSync(pkgPath, 'utf8')) as { version?: string };
    return pkg.version ?? '0.0.0';
  } catch {
    return '0.0.0';
  }
}

/** Собирает программу Commander со всеми командами. */
export function buildProgram(): Command {
  const program = new Command();

  program
    .name('promptwizard')
    .description(
      'PromptWizard — CLI-ассистент для сборки качественных промтов\n' +
        '(изображения, код, тексты, видео, музыка). Работает автономно, без API-ключей и сети.',
    )
    .version(readVersion())
    .showHelpAfterError()
    .helpCommand('help [команда]', 'показать справку по команде');

  registerGenerateCommand(program);
  registerInteractiveCommand(program);
  registerTuiCommand(program);
  registerListTypesCommand(program);
  registerListTemplatesCommand(program);
  registerRefineCommand(program);
  registerConfigCommand(program);
  registerDoctorCommand(program);

  return program;
}

/** Точка запуска CLI: централизованная обработка ошибок без stack trace наружу. */
export async function runCli(argv: string[]): Promise<void> {
  const program = buildProgram();
  try {
    await program.parseAsync(argv);
  } catch (error) {
    if (isPromptCancelled(error)) {
      // Ctrl+C / ESC в inquirer-промптах: тихий выход без трейсбека (130 — SIGINT-конвенция).
      console.error(chalk.yellow('Отменено пользователем.'));
      process.exitCode = 130;
      return;
    }
    printFatal(error);
    process.exitCode = 1;
  }
}

/** @inquirer/core бросает ExitPromptError (Ctrl+C/закрытие) и CancelPromptError (ESC). */
function isPromptCancelled(error: unknown): boolean {
  if (!(error instanceof Error)) return false;
  return (
    error.name === 'ExitPromptError' ||
    error.name === 'CancelPromptError' ||
    error.name === 'AbortPromptError'
  );
}

function printFatal(error: unknown): void {
  if (error instanceof PromptWizardError) {
    console.error(chalk.red(`Ошибка: ${error.message}`));
    return;
  }
  const message = error instanceof Error ? error.message : String(error);
  console.error(chalk.red(`Внутренняя ошибка: ${message}`));
  if (process.env.PROMPTWIZARD_DEBUG !== undefined && error instanceof Error && error.stack) {
    console.error(chalk.gray(error.stack));
  } else {
    console.error(chalk.gray('Включите PROMPTWIZARD_DEBUG=1 для подробного отчёта.'));
  }
}
