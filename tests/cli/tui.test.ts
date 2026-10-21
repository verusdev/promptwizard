import { describe, expect, it } from 'vitest';
import { stripAnsi } from '../helpers/ansi.js';
import { hasStackTrace, runCli } from '../helpers/cli.js';

/**
 * MT13 — интеграционные тесты команды `promptwizard tui`.
 *
 * Тесты спавнят dist/index.js дочерним процессом (нужен npm run build),
 * сеть не используется: команда tui не обращается к внешним сервисам.
 */

/* ------------------------------------------------------------------ */
/* Справка                                                             */
/* ------------------------------------------------------------------ */

describe('CLI: tui --help', () => {
  it('tui --help: exit 0, usage и описание команды', async () => {
    const result = await runCli(['tui', '--help']);

    expect(result.code).toBe(0);
    const out = stripAnsi(result.stdout);
    expect(out).toContain('tui');
    expect(out).toMatch(/Usage:\s*promptwizard tui/);
    expect(out).toMatch(/TUI/);
    expect(out).toMatch(/промт/i);
    expect(hasStackTrace(result.stderr)).toBe(false);
  });

  it('tui --help: справка в stdout, stderr пуст', async () => {
    const result = await runCli(['tui', '--help']);

    expect(result.code).toBe(0);
    expect(stripAnsi(result.stdout).length).toBeGreaterThan(0);
    expect(result.stderr.trim()).toBe('');
  });

  it('общая справка --help содержит команду tui', async () => {
    const result = await runCli(['--help']);

    expect(result.code).toBe(0);
    const out = stripAnsi(result.stdout);
    // Строка команды в списке команд.
    expect(out).toMatch(/^\s*tui\s{2,}\S/m);
    expect(out).toMatch(/TUI/);
    expect(hasStackTrace(result.stderr)).toBe(false);
  });

  it('help tui (подкоманда help) показывает справку tui', async () => {
    const result = await runCli(['help', 'tui']);

    expect(result.code).toBe(0);
    const out = stripAnsi(result.stdout);
    expect(out).toMatch(/Usage:\s*promptwizard tui/);
    expect(out).toMatch(/TUI/);
    expect(hasStackTrace(result.stderr)).toBe(false);
  });
});

/* ------------------------------------------------------------------ */
/* Не-TTY: понятный отказ вместо падения/зависания                     */
/* ------------------------------------------------------------------ */

describe('CLI: tui в не-TTY окружении', () => {
  it('tui с пайпом на stdin → exit ≠ 0, понятное сообщение про TTY, без stack trace', async () => {
    const result = await runCli(['tui'], { input: 'x' });

    expect(result.code).not.toBe(0);
    expect(result.code).toBe(1);
    const err = stripAnsi(result.stderr);
    expect(err).toMatch(/Ошибка/);
    expect(err).toMatch(/TTY/);
    expect(hasStackTrace(result.stderr)).toBe(false);
  });

  it('tui без данных на stdin (закрытый пайп) → exit ≠ 0, отказ без stack trace', async () => {
    const result = await runCli(['tui']);

    expect(result.code).not.toBe(0);
    expect(result.code).toBe(1);
    expect(stripAnsi(result.stderr)).toMatch(/TTY/);
    expect(hasStackTrace(result.stderr)).toBe(false);
  });

  it('сообщение об отказе подсказывает неинтерактивную альтернативу generate', async () => {
    const result = await runCli(['tui'], { input: 'x' });

    expect(result.code).toBe(1);
    const err = stripAnsi(result.stderr);
    expect(err).toMatch(/generate/);
    expect(err).toMatch(/--type/);
  });

  it('отказ не печатает stack trace и не оставляет мусор в stdout', async () => {
    const result = await runCli(['tui'], { input: 'x' });

    expect(result.code).toBe(1);
    expect(hasStackTrace(result.stderr)).toBe(false);
    expect(hasStackTrace(result.stdout)).toBe(false);
    expect(stripAnsi(result.stdout).trim()).toBe('');
  });
});
