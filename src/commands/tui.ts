import type { Command } from 'commander';
import { ValidationError } from '../lib/engine/errors.js';
import { loadRegistry } from '../lib/templates/registry.js';
import { runTui } from '../lib/tui/index.js';

export function registerTuiCommand(program: Command): void {
  program
    .command('tui')
    .description('Полноэкранный многопанельный TUI для сборки промтов')
    .action(async () => {
      if (!process.stdin.isTTY || !process.stdout.isTTY) {
        throw new ValidationError(
          'TUI-интерфейсу нужен интерактивный терминал (TTY), а запущен пайп или не-интерактивная консоль. ' +
            'Запустите "promptwizard tui" в обычной консоли либо соберите промт неинтерактивно: ' +
            'promptwizard generate --type image --platform midjourney --subject "..."',
        );
      }

      const registry = await loadRegistry();
      await runTui(registry);
    });
}
