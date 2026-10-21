import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import chalk from 'chalk';
import type { PromptResult } from './engine/builder.js';
import { OutputError } from './engine/errors.js';
import { copyToClipboard } from './clipboard.js';

export interface EmitOptions {
  /** Записать результат в файл (UTF-8, родительские каталоги создаются). */
  out?: string;
  /** Скопировать промт в буфер обмена. */
  copy?: boolean;
  /** Машинный формат JSON вместо текста. */
  json?: boolean;
}

/**
 * Выводит собранное приложение: stdout (по умолчанию) / файл / буфер обмена.
 * Служебные сообщения идут в stderr, чтобы stdout оставался чистым для пайпов.
 */
export async function emitPrompt(result: PromptResult, options: EmitOptions = {}): Promise<void> {
  const payload = options.json === true ? toJson(result) : `${result.prompt}\n`;
  await emit(result.prompt, payload, options);
}

/**
 * Выводит произвольный текст (например, результат LLM-доработки) по тем же
 * правилам, что и промт: stdout / --out / --copy; --json оборачивает в {prompt}.
 */
export async function emitText(text: string, options: EmitOptions = {}): Promise<void> {
  const payload =
    options.json === true ? `${JSON.stringify({ prompt: text }, null, 2)}\n` : `${text}\n`;
  await emit(text, payload, options);
}

async function emit(text: string, payload: string, options: EmitOptions): Promise<void> {
  if (options.out !== undefined && options.out !== '') {
    await writeOutputFile(options.out, payload);
    console.error(chalk.green(`✓ Сохранено в файл: ${path.resolve(options.out)}`));
  } else {
    process.stdout.write(payload);
  }

  if (options.copy === true) {
    const clipboard = await copyToClipboard(text);
    if (clipboard.ok) {
      console.error(chalk.green('✓ Промт скопирован в буфер обмена'));
    } else {
      // Не роняем процесс: пользователь уже получил промт.
      console.error(chalk.yellow(`⚠ Не удалось скопировать в буфер обмена: ${clipboard.message}`));
    }
  }
}

/** Записывает текст в файл: UTF-8, создание родительских каталогов. */
export async function writeOutputFile(filePath: string, content: string): Promise<void> {
  const resolved = path.resolve(filePath);
  try {
    await mkdir(path.dirname(resolved), { recursive: true });
    await writeFile(resolved, content, 'utf8');
  } catch (error) {
    throw new OutputError(
      `не удалось записать файл "${resolved}": ${error instanceof Error ? error.message : String(error)}`,
    );
  }
}

/** Машинный формат результата для --json. */
export function toJson(result: PromptResult): string {
  return `${JSON.stringify(
    {
      prompt: result.prompt,
      negative: result.negative,
      template: result.template,
      type: result.type,
      platform: result.platform,
      slots: result.slots,
      params: result.params,
    },
    null,
    2,
  )}\n`;
}
