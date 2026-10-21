import { spawn } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * Инфраструктура интеграционных тестов CLI: запуск dist/index.js дочерним
 * процессом. Учитывает Windows: путь к node берётся из process.execPath
 * (не полагаемся на ассоциации .js), пути к рабочим каталогам содержат пробелы.
 */

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');

/** Абсолютный путь к собранной точке входа (нужен npm run build). */
export const CLI_ENTRY = path.join(projectRoot, 'dist', 'index.js');

export interface CliResult {
  code: number | null;
  stdout: string;
  stderr: string;
}

export interface RunCliOptions {
  /** Рабочий каталог процесса (по умолчанию — корень проекта). */
  cwd?: string;
  /** Дополнительные env-переменные (перекрывают отфильтрованный окружение). */
  env?: Record<string, string>;
  /** Данные для stdin (пайп). */
  input?: string;
}

/**
 * Окружение дочернего процесса: все PROMPTWIZARD_* переменные вычищаются,
 * чтобы тесты были детерминированы (ключей LLM в окружении CI быть не должно).
 */
function childEnv(extra: Record<string, string> | undefined): Record<string, string> {
  const env: Record<string, string> = {};
  for (const [key, value] of Object.entries(process.env)) {
    if (value !== undefined && !key.startsWith('PROMPTWIZARD_')) {
      env[key] = value;
    }
  }
  return { ...env, ...(extra ?? {}) };
}

/** Запускает `node dist/index.js <args>` и возвращает код/потоки целиком. */
export function runCli(args: string[], options: RunCliOptions = {}): Promise<CliResult> {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [CLI_ENTRY, ...args], {
      cwd: options.cwd ?? projectRoot,
      env: childEnv(options.env),
      windowsHide: true,
      stdio: ['pipe', 'pipe', 'pipe'],
    });

    let stdout = '';
    let stderr = '';
    child.stdout.setEncoding('utf8');
    child.stderr.setEncoding('utf8');
    child.stdout.on('data', (chunk: string) => {
      stdout += chunk;
    });
    child.stderr.on('data', (chunk: string) => {
      stderr += chunk;
    });

    const timer = setTimeout(() => {
      child.kill();
      reject(new Error(`CLI завис: ${args.join(' ')}\nstdout: ${stdout}\nstderr: ${stderr}`));
    }, 30_000);

    child.on('error', (error) => {
      clearTimeout(timer);
      reject(error);
    });
    child.on('close', (code) => {
      clearTimeout(timer);
      resolve({ code, stdout, stderr });
    });

    if (options.input !== undefined) {
      child.stdin.end(options.input, 'utf8');
    } else {
      child.stdin.end();
    }
  });
}

/**
 * Создаёт временный каталог с ПРОБЕЛОМ в пути («prompt wizard ...») —
 * проверяет устойчивость CLI к Windows-путям с пробелами.
 * Удаляется автоматически в afterAll.
 */
export function makeSpaceyTmpDir(prefix = 'prompt wizard tests '): string {
  return mkdtempSync(path.join(tmpdir(), prefix));
}

/** Удаляет временный каталог (best-effort). */
export function removeTmpDir(dir: string): void {
  rmSync(dir, { recursive: true, force: true });
}

/** Негативная проверка «нет stack trace»: нет строк "    at ..." и путей модулей. */
export function hasStackTrace(text: string): boolean {
  return /^\s+at\s+\S/m.test(text) || text.includes('node:internal');
}
