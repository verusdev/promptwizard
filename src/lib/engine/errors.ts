/**
 * Типизированные ошибки PromptWizard.
 *
 * Все ошибки наследуются от PromptWizardError: CLI-слой печатает только
 * человекочитаемое message (без stack trace) и завершает процесс с exit ≠ 0.
 */

export interface PromptWizardErrorOptions {
  cause?: unknown;
}

/** Базовый класс всех ошибок, которые CLI показывает пользователю «как есть». */
export abstract class PromptWizardError extends Error {
  abstract readonly exitCode: number;

  constructor(message: string, options: PromptWizardErrorOptions = {}) {
    super(message, options.cause !== undefined ? { cause: options.cause } : undefined);
    this.name = new.target.name;
  }
}

/** Ошибка чтения/валидации JSON-шаблона; file — точный путь к проблемному файлу. */
export class TemplateLoadError extends PromptWizardError {
  readonly exitCode = 1;
  readonly file: string;

  constructor(file: string, details: string, options: PromptWizardErrorOptions = {}) {
    super(`Шаблон не загружен (${file}): ${details}`, options);
    this.file = file;
  }
}

/** Ошибка конфигурации: невалидный rc-файл, недопустимое значение env и т.п. */
export class ConfigError extends PromptWizardError {
  readonly exitCode = 1;
  readonly file: string | null;

  constructor(message: string, file: string | null = null, options: PromptWizardErrorOptions = {}) {
    super(file ? `${message} (файл: ${file})` : message, options);
    this.file = file;
  }
}

/** Ошибка валидации пользовательского ввода (флаги, слоты, параметры). */
export class ValidationError extends PromptWizardError {
  readonly exitCode = 1;
  readonly field: string | undefined;
  readonly allowed: readonly string[] | undefined;

  constructor(
    message: string,
    details: { field?: string; allowed?: readonly string[]; cause?: unknown } = {},
  ) {
    super(message, details.cause !== undefined ? { cause: details.cause } : {});
    this.field = details.field;
    this.allowed = details.allowed;
  }
}

/** Неизвестный тип промта (image/code/text/video/music). */
export class UnknownPromptTypeError extends ValidationError {
  constructor(received: string, allowed: readonly string[]) {
    super(`Неизвестный тип промта "${received}". Допустимые типы: ${allowed.join(', ')}.`, {
      field: 'type',
      allowed,
    });
  }
}

/** Неизвестная платформа для выбранного типа промта. */
export class UnknownPlatformError extends ValidationError {
  constructor(received: string, type: string, allowed: readonly string[]) {
    super(
      `Для типа "${type}" неизвестная платформа "${received}". ` +
        `Доступные платформы: ${allowed.join(', ')}.`,
      { field: 'platform', allowed },
    );
  }
}

/** Ошибка сборки промта движком (незаполненный слот, битый шаблон и т.п.). */
export class BuildError extends PromptWizardError {
  readonly exitCode = 1;
  readonly templateId: string | undefined;
  readonly slot: string | undefined;
  readonly allowedSlots: readonly string[] | undefined;

  constructor(
    message: string,
    details: {
      templateId?: string;
      slot?: string;
      allowedSlots?: readonly string[];
      cause?: unknown;
    } = {},
  ) {
    super(message, details.cause !== undefined ? { cause: details.cause } : {});
    this.templateId = details.templateId;
    this.slot = details.slot;
    this.allowedSlots = details.allowedSlots;
  }
}

/** Ошибка вывода: не удалось записать файл, скопировать в буфер обмена и т.п. */
export class OutputError extends PromptWizardError {
  readonly exitCode = 1;
}

/**
 * LLM не настроен: нет API-ключа.
 * `refine` завершается с этой ошибкой (exit ≠ 0); `generate --refine` деградирует
 * до локального результата с предупреждением (S1 — generate обязан работать без ключа).
 */
export class LlmNotConfiguredError extends PromptWizardError {
  readonly exitCode = 1;

  constructor(
    message = 'LLM не настроен: задайте PROMPTWIZARD_LLM_API_KEY или задайте ключ через config set llm.apiKey <ключ> ' +
      '(провайдер — config set llm.provider openai|anthropic).',
  ) {
    super(message);
  }
}

/**
 * Ошибка запроса к LLM API: сеть, таймаут, HTTP-статус, неожиданный формат ответа.
 * API-ключ в сообщение не попадает (только маска).
 */
export class LlmRequestError extends PromptWizardError {
  readonly exitCode = 1;
}
