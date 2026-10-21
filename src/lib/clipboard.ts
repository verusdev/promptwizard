import { spawn } from 'node:child_process';

export interface ClipboardResult {
  ok: boolean;
  message: string | null;
}

/**
 * Кросс-платформенное копирование в буфер обмена.
 * win32 → powershell.exe Set-Clipboard (текст передаётся через stdin,
 * чтобы не упираться в лимиты командной строки и квотирование).
 */
export async function copyToClipboard(text: string): Promise<ClipboardResult> {
  const platform = process.platform;
  if (platform === 'win32') {
    // Set-Clipboard не читает stdin процесса напрямую — берём текст из [Console]::In.
    return runWithStdin(
      'powershell.exe',
      [
        '-NoProfile',
        '-NonInteractive',
        '-Command',
        '$t = [Console]::In.ReadToEnd(); Set-Clipboard -Value $t',
      ],
      text,
    );
  }
  if (platform === 'darwin') {
    return runWithStdin('pbcopy', [], text);
  }
  // Linux: пробуем современные инструменты по порядку.
  for (const [command, args] of [
    ['wl-copy', []],
    ['xclip', ['-selection', 'clipboard']],
    ['xsel', ['--clipboard', '--input']],
  ] as const) {
    const result = await runWithStdin(command, [...args], text);
    if (result.ok) {
      return result;
    }
  }
  return {
    ok: false,
    message:
      'не найден ни wl-copy, ни xclip, ни xsel — установите один из них или используйте --out',
  };
}

function runWithStdin(
  command: string,
  args: readonly string[],
  text: string,
): Promise<ClipboardResult> {
  return new Promise((resolve) => {
    let settled = false;
    const finish = (result: ClipboardResult): void => {
      if (!settled) {
        settled = true;
        resolve(result);
      }
    };

    let child;
    try {
      child = spawn(command, [...args], { stdio: ['pipe', 'ignore', 'pipe'] });
    } catch (error) {
      finish({ ok: false, message: `не удалось запустить ${command}: ${messageOf(error)}` });
      return;
    }

    let stderr = '';
    child.stderr?.on('data', (chunk: Buffer) => {
      stderr += chunk.toString('utf8');
    });

    child.on('error', (error) => {
      finish({ ok: false, message: `ошибка запуска ${command}: ${messageOf(error)}` });
    });

    child.on('close', (code) => {
      if (code === 0) {
        finish({ ok: true, message: null });
      } else {
        const detail = stderr.trim();
        finish({
          ok: false,
          message: `${command} завершился с кодом ${code}${detail !== '' ? `: ${detail}` : ''}`,
        });
      }
    });

    child.stdin?.on('error', () => {
      /* процесс мог закрыть stdin раньше — проверим по коду выхода */
    });
    child.stdin?.end(text, 'utf8');
  });
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
