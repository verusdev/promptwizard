import type { Rule, Template } from '../schemas.js';

/**
 * Правила платформ: оценка условий, сборка действий и форматирование параметров.
 *
 * Модуль детерминирован и не знает ничего про сеть/LLM: чистые функции над данными шаблона.
 */

export interface RuleContext {
  /** Значения слотов после разрешения значений по умолчанию (только заполненные). */
  slots: Readonly<Record<string, string>>;
  /** Флаги команды (пока поддерживается только negative). */
  flags: Readonly<Record<string, boolean>>;
}

export interface RuleActions {
  /** Строки, добавляемые в конец основной части (в порядке правил шаблона). */
  appends: string[];
  /** Строки, добавляемые в начало основной части. */
  prepends: string[];
  /** Точечные замены подстрок. */
  replaces: Array<{ find: string; with: string }>;
  /** Фрагменты негативного блока. */
  negatives: string[];
  /** Параметры, устанавливаемые правилами (канонические ключи вида "--ar"). */
  params: Array<{ key: string; value: string }>;
  /** Параметры, которые нужно убрать (канонические ключи). */
  removals: string[];
}

/**
 * Проверяет условие правила.
 * Отсутствующий `when` означает «всегда».
 * Условие только с `slot` (без equals/notEquals/in) истинно, когда слот заполнен.
 *
 * `equals`/`notEquals` — совпадение по подстроке: значение слота считается совпавшим,
 * если содержит ожидаемый фрагмент (точное равенство — частный случай). Так правило
 * `{ equals: "кот" }` срабатывает и на значении "кот и ещё кот", а `replace` затем
 * заменяет все вхождения в уже собранной строке.
 */
export function conditionMatches(when: Rule['when'], context: RuleContext): boolean {
  if (when === undefined) {
    return true;
  }

  if (when.flag !== undefined) {
    if (context.flags[when.flag] !== true) {
      return false;
    }
  }

  if (when.slot !== undefined) {
    const value = context.slots[when.slot];
    if (value === undefined) {
      return false;
    }
    if (when.equals !== undefined && !value.includes(when.equals)) {
      return false;
    }
    if (when.notEquals !== undefined && value.includes(when.notEquals)) {
      return false;
    }
    if (when.in !== undefined && !when.in.includes(value)) {
      return false;
    }
  }

  return true;
}

/** Собирает действия всех сработавших правил шаблона (детерминированный порядок). */
export function collectRuleActions(template: Template, context: RuleContext): RuleActions {
  const actions: RuleActions = {
    appends: [],
    prepends: [],
    replaces: [],
    negatives: [],
    params: [],
    removals: [],
  };

  for (const rule of template.rules) {
    if (!conditionMatches(rule.when, context)) {
      continue;
    }
    if (rule.append !== undefined) {
      actions.appends.push(rule.append);
    }
    if (rule.prepend !== undefined) {
      actions.prepends.push(rule.prepend);
    }
    if (rule.replace !== undefined) {
      actions.replaces.push(rule.replace);
    }
    if (rule.negative !== undefined) {
      actions.negatives.push(rule.negative);
    }
    if (rule.setParam !== undefined) {
      for (const [key, value] of Object.entries(rule.setParam)) {
        actions.params.push({ key: canonicalParamKey(key), value });
      }
    }
    if (rule.removeParam !== undefined) {
      for (const key of rule.removeParam) {
        actions.removals.push(canonicalParamKey(key));
      }
    }
  }

  return actions;
}

/** "--ar"/"ar" → "--ar"; все прочие ключи получают префикс "--", если его нет. */
export function canonicalParamKey(key: string): string {
  const trimmed = key.trim();
  return trimmed.startsWith('-') ? trimmed : `--${trimmed}`;
}

/** Сравнение ключей параметров без учёта регистра и ведущих дефисов. */
export function normalizeParamKey(key: string): string {
  return canonicalParamKey(key).toLowerCase();
}

/** Блочный формат параметров в духе Stable Diffusion: "Steps: 28, Sampler: Euler a, ...". */
const SD_PARAM_ORDER: Array<{ key: string; label: string }> = [
  { key: '--steps', label: 'Steps' },
  { key: '--sampler', label: 'Sampler' },
  { key: '--cfg', label: 'CFG scale' },
  { key: '--seed', label: 'Seed' },
  { key: '--model', label: 'Model' },
];

/** Рендерит объединённые параметры одной строкой: "--ar 16:9 --v 6.1". */
export function renderInlineParams(params: ReadonlyMap<string, string>): string {
  const parts: string[] = [];
  for (const [key, value] of params) {
    if (value.trim() === '') continue;
    parts.push(`${key} ${value}`);
  }
  return parts.join(' ');
}

/** Рендерит параметры в стиле Stable Diffusion (фиксированный порядок для детерминизма). */
export function renderSdParams(params: ReadonlyMap<string, string>): string {
  const lookup = new Map<string, string>();
  for (const [key, value] of params) {
    lookup.set(normalizeParamKey(key), value);
  }

  const parts: string[] = [];
  for (const entry of SD_PARAM_ORDER) {
    const value = lookup.get(entry.key);
    if (value !== undefined && value.trim() !== '') {
      parts.push(`${entry.label}: ${value}`);
    }
  }
  return parts.join(', ');
}
