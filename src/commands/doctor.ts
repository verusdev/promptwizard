import { readdir } from 'node:fs/promises';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import chalk from 'chalk';
import type { Command } from 'commander';
import { loadConfig, maskSecret } from '../lib/config.js';
import { loadRegistry } from '../lib/templates/registry.js';
import { PROMPT_TYPES } from '../lib/schemas.js';

/**
 * Диагностика окружения (T11): Node, конфиг, ключ (маска), база шаблонов,
 * ассеты сборки (ловушка R6), буфер обмена (best-effort).
 *
 * Отсутствие API-ключа — НЕ ошибка: «LLM не настроен, автономный режим работает», exit 0.
 */

/** Каталог ассетов рядом со скомпилированным модулем (dist/lib → dist/templates). */
const TEMPLATES_ASSET_DIR = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '..',
  'templates',
);

export function registerDoctorCommand(program: Command): void {
  program
    .command('doctor')
    .description('Диагностика окружения: Node, конфигурация, API-ключ, целостность базы шаблонов')
    .action(async () => {
      console.log(chalk.bold('PromptWizard — диагностика окружения'));
      console.log('');

      let problems = 0;
      const ok = (line: string): void => console.log(chalk.green('✓') + ' ' + line);
      const info = (line: string): void => console.log(chalk.blue('ℹ') + ' ' + line);
      const fail = (line: string): void => {
        problems += 1;
        console.log(chalk.red('✗') + ' ' + line);
      };

      // 1. Node.js
      const major = Number.parseInt(process.versions.node.split('.')[0] ?? '0', 10);
      if (major >= 20) {
        ok(`Node.js ${process.version} (нужен >= 20) · ${process.platform}/${process.arch}`);
      } else {
        fail(
          `Node.js ${process.version} слишком старый — нужен >= 20 (рекомендуется актуальный LTS).`,
        );
      }

      // 2. Конфигурация и ключ (ключ — только маской!)
      try {
        const loaded = await loadConfig();
        if (loaded.file !== null) {
          ok(`Конфигурация: ${loaded.file}`);
        } else {
          info('Конфигурация: rc-файл не найден (используются env-переменные и дефолты).');
        }

        const llm = loaded.config.llm;
        ok(`Провайдер LLM: ${llm.provider}`);
        if (llm.apiKey !== null) {
          const origin = loaded.origins['llm.apiKey'];
          const originText =
            origin === 'env'
              ? 'из PROMPTWIZARD_LLM_API_KEY'
              : origin === 'file'
                ? 'из rc-файла'
                : 'из дефолтов';
          ok(`API-ключ: задан, ${maskSecret(llm.apiKey)} (${originText})`);
          ok(
            `LLM-доработка готова к работе: провайдер ${llm.provider}, модель ${llm.model ?? 'по умолчанию'}.`,
          );
        } else {
          info(
            'LLM не настроен, автономный режим работает (generate/interactive без ключей и сети).',
          );
        }
      } catch (error) {
        fail(`Конфигурация: ${error instanceof Error ? error.message : String(error)}`);
      }

      // 3. База шаблонов (реестр: чтение + валидация Zod каждого файла)
      try {
        const registry = await loadRegistry();
        const total = registry.templates.length;
        const byType = PROMPT_TYPES.map((type) => {
          const count = registry.byType.get(type)?.length ?? 0;
          return `${type}: ${count}`;
        }).join(' · ');
        ok(`База шаблонов: ${total} шаблонов, все валидны (${registry.dir})`);
        info(byType);
      } catch (error) {
        fail(`База шаблонов: ${error instanceof Error ? error.message : String(error)}`);
      }

      // 4. Ассеты сборки (ловушка R6: dist/templates рядом с бинарником)
      try {
        const jsonCount = await countJsonRecursive(TEMPLATES_ASSET_DIR);
        if (jsonCount > 0) {
          ok(`Ассеты сборки: ${TEMPLATES_ASSET_DIR} (JSON-шаблонов: ${jsonCount})`);
        } else {
          fail(
            `Ассеты сборки: в ${TEMPLATES_ASSET_DIR} нет JSON-шаблонов — выполните npm run build.`,
          );
        }
      } catch {
        fail(
          `Ассеты сборки: каталог ${TEMPLATES_ASSET_DIR} не найден — выполните npm run build (копирование src/templates → dist/templates).`,
        );
      }

      // 5. Буфер обмена (best-effort, без изменения содержимого буфера)
      const clipboard = await checkClipboard();
      if (clipboard.ok) {
        ok(`Буфер обмена: доступен (${clipboard.detail})`);
      } else {
        info(
          `Буфер обмена: недоступен (${clipboard.detail}) — используйте --out для сохранения в файл.`,
        );
      }

      console.log('');
      if (problems === 0) {
        console.log(chalk.green('Всё в порядке: автономный режим работает.'));
      } else {
        console.log(chalk.red(`Найдено проблем: ${problems}.`));
        process.exitCode = 1;
      }
    });
}

/* ------------------------------------------------------------------ */
/* Проверка буфера обмена (best-effort, чтение не мутирует буфер)      */
/* ------------------------------------------------------------------ */

async function checkClipboard(): Promise<{ ok: boolean; detail: string }> {
  const probes: Array<{ command: string; args: readonly string[]; detail: string }> =
    process.platform === 'win32'
      ? [
          {
            command: 'powershell.exe',
            args: ['-NoProfile', '-NonInteractive', '-Command', 'exit 0'],
            detail: 'PowerShell Set-Clipboard',
          },
        ]
      : process.platform === 'darwin'
        ? [{ command: 'pbpaste', args: [], detail: 'pbcopy/pbpaste' }]
        : [
            { command: 'wl-paste', args: [], detail: 'wl-copy/wl-paste' },
            { command: 'xclip', args: ['-selection', 'clipboard', '-o'], detail: 'xclip' },
            { command: 'xsel', args: ['--clipboard', '--output'], detail: 'xsel' },
          ];

  let lastError = 'не найдена подходящая команда';
  for (const probe of probes) {
    const result = await runProbe(probe.command, probe.args);
    if (result.ok) {
      return { ok: true, detail: probe.detail };
    }
    lastError = result.message;
  }
  return { ok: false, detail: lastError };
}

/** Рекурсивный подсчёт *.json (шаблоны лежат в подкаталогах по типам). */
async function countJsonRecursive(dir: string): Promise<number> {
  const entries = await readdir(dir, { withFileTypes: true });
  let count = 0;
  for (const entry of entries) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      count += await countJsonRecursive(full);
    } else if (entry.isFile() && entry.name.toLowerCase().endsWith('.json')) {
      count += 1;
    }
  }
  return count;
}

/** Запускает команду без stdin (чтение буфера не меняет его содержимое). */
function runProbe(
  command: string,
  args: readonly string[],
): Promise<{ ok: boolean; message: string }> {
  return new Promise((resolve) => {
    let child;
    try {
      child = spawn(command, [...args], { stdio: ['ignore', 'ignore', 'pipe'] });
    } catch (error) {
      resolve({ ok: false, message: errorText(error) });
      return;
    }
    let stderr = '';
    child.stderr?.on('data', (chunk: Buffer) => {
      stderr += chunk.toString('utf8');
    });
    child.on('error', (error) => {
      resolve({ ok: false, message: errorText(error) });
    });
    child.on('close', (code) => {
      if (code === 0) {
        resolve({ ok: true, message: '' });
      } else {
        resolve({
          ok: false,
          message: `код выхода ${code}${stderr.trim() !== '' ? `: ${stderr.trim()}` : ''}`,
        });
      }
    });
  });
}

function errorText(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
