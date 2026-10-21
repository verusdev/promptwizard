import type { Slot, Template } from '../schemas.js';
import { BuildError, ValidationError } from './errors.js';
import {
  canonicalParamKey,
  collectRuleActions,
  normalizeParamKey,
  renderInlineParams,
  renderSdParams,
} from './rules.js';

/**
 * Движок сборки промта: шаблон + слоты/параметры пользователя + правила.
 *
 * Гарантии:
 * - детерминированность: одинаковый вход → одинаковый выход;
 * - никаких обращений к сети и ФС — только чистые вычисления;
 * - понятные ошибки: незаполненный обязательный слот, неизвестный слот
 *   (сo списком допустимых), невалидное значение enum/number.
 */

/** Вход для сборки промта (флаги CLI или ответы интерактива). */
export interface BuildInput {
  /** Значения слотов (ключ слота → строковое значение). */
  slots?: Readonly<Record<string, string>>;
  /** Пользовательские параметры ("--ar"/"ar" → значение); перекрывают defaults и слоты. */
  params?: Readonly<Record<string, string>>;
  /** Дополнительный негативный текст от пользователя (добавляется к негативному блоку). */
  negative?: string;
  /** Флаги: negative — включает правила с when.flag="negative". */
  flags?: { negative?: boolean };
}

/** Результат сборки: итоговый текст плюс структурированные детали. */
export interface PromptResult {
  /** Итоговый текст промта (включает негативный блок и параметры по формату шаблона). */
  prompt: string;
  /** Основная часть без негативного блока и параметров. */
  core: string;
  /** Негативный блок, если он собран. */
  negative: string | null;
  /** Объединённые параметры в порядке рендера. */
  params: Record<string, string>;
  /** Заполненные слоты (после применения значений по умолчанию). */
  slots: Record<string, string>;
  /** Метаданные шаблона, которым собран промт. */
  template: string;
  type: Template['type'];
  platform: string;
}

const PLACEHOLDER_RE = /\{([a-z][a-z0-9_-]*)\}/gi;
const PARAMS_PLACEHOLDER = 'params';
/** Невидимый маркер пустого слота (код 1), убирается на этапе tidyText. */
const EMPTY_SLOT_MARK = String.fromCharCode(1);

/**
 * Стандартные слоты, которые команда `generate` поддерживает как first-class флаги
 * (`--subject`, `--style`). Если шаблон ссылается на них через плейсхолдер, но не
 * объявляет их в `slots`, движок выводит слот сам: `subject` — обязательный, `style` —
 * необязательный. Любой другой необъявленный плейсхолдер, не переданный пользователем,
 * считается ошибкой автора шаблона.
 */
const STANDARD_SLOTS: ReadonlyArray<{ key: string; required: boolean }> = [
  { key: 'subject', required: true },
  { key: 'style', required: false },
];

/**
 * Собирает промт по шаблону.
 *
 * Порядок слияния параметров (ключ канонизируется: "ar" → "--ar"):
 *   defaults шаблона → слоты с param → действия правил → пользовательские --param.
 * При совпадении ключей выигрывает более поздний источник (пользователь — самый сильный).
 */
export function buildPrompt(template: Template, input: BuildInput = {}): PromptResult {
  const declaredKeys = template.slots.map((slot) => slot.key);
  const providedSlots = input.slots ?? {};

  // 1. Собираем «известные» слоты шаблона: объявленные в схеме + выведенные из
  //    плейсхолдеров стандартные слоты (subject/style) + необъявленные плейсхолдеры,
  //    значения которых пользователь всё же передал (обратная совместимость с
  //    шаблонами, где слоты не описаны явно — см. tests/helpers/fixtures.ts).
  const inferredKeys: string[] = [];
  const allPlaceholders = [...template.template.matchAll(PLACEHOLDER_RE)].map((m) => m[1] ?? '');
  for (const placeholder of allPlaceholders) {
    if (
      placeholder === '' ||
      placeholder === PARAMS_PLACEHOLDER ||
      declaredKeys.includes(placeholder) ||
      inferredKeys.includes(placeholder)
    ) {
      continue;
    }
    const isStandard = STANDARD_SLOTS.some((slot) => slot.key === placeholder);
    if (isStandard || providedSlots[placeholder] !== undefined) {
      inferredKeys.push(placeholder);
    }
  }
  const knownSlotKeys = [...declaredKeys, ...inferredKeys];

  // 2. Неизвестные переданные слоты — ошибка со списком допустимых.
  for (const key of Object.keys(providedSlots)) {
    if (!knownSlotKeys.includes(key)) {
      throw new BuildError(
        `Неизвестный слот "${key}" для шаблона "${template.id}". Допустимые слоты: ${knownSlotKeys.join(', ')}.`,
        { templateId: template.id, slot: key, allowedSlots: knownSlotKeys },
      );
    }
  }

  // 3. Плейсхолдеры шаблона, ссылающиеся на неизвестный слот, — ошибка автора шаблона.
  for (const key of allPlaceholders) {
    if (key === '' || key === PARAMS_PLACEHOLDER) continue;
    if (!knownSlotKeys.includes(key)) {
      throw new BuildError(
        `Шаблон "${template.id}" ссылается на неизвестный слот "{${key}}"; допустимые: ${[...knownSlotKeys, PARAMS_PLACEHOLDER].join(', ')}.`,
        { templateId: template.id, slot: key, allowedSlots: knownSlotKeys },
      );
    }
  }

  // 4. Разрешение значений слотов: переданное значение → default; обязательные проверяются.
  const values: Record<string, string> = {};
  for (const slot of template.slots) {
    const provided = providedSlots[slot.key];
    const value = (provided ?? slot.default ?? '').trim();
    if (value === '') {
      if (slot.required) {
        throw new BuildError(
          `Не заполнен обязательный слот "${slot.key}" (${slot.label}) шаблона "${template.id}".`,
          { templateId: template.id, slot: slot.key, allowedSlots: knownSlotKeys },
        );
      }
      continue;
    }
    validateSlotValue(template, slot, value);
    values[slot.key] = value;
  }
  // Выведенные из плейсхолдеров слоты: обязательные (subject) проверяются на заполненность;
  // остальные просто подставляются, если переданы.
  for (const key of inferredKeys) {
    const value = (providedSlots[key] ?? '').trim();
    const required = STANDARD_SLOTS.find((slot) => slot.key === key)?.required === true;
    if (value === '') {
      if (required) {
        throw new BuildError(
          `Не заполнен обязательный слот "${key}" (${key}) шаблона "${template.id}".`,
          { templateId: template.id, slot: key, allowedSlots: knownSlotKeys },
        );
      }
      continue;
    }
    values[key] = value;
  }

  // 5. Правила шаблона.
  const actions = collectRuleActions(template, {
    slots: values,
    flags: { negative: input.flags?.negative === true },
  });

  // 6. Подстановка слотов + применение append/prepend/replace.
  // Порядок фиксирован и детерминирован: сначала подстановка слотов в шаблон,
  // затем prepend (в порядке правил, каждый следующий идёт раньше предыдущего),
  // затем append, и только потом replace — он видит уже склеенную строку и заменяет
  // все вхождения. Пустые слоты помечаются невидимым маркером: tidyText уберёт маркер
  // вместе с висячими разделителями и строкой-меткой, потерявшей содержимое, но не
  // тронет настоящие заголовки шаблона (например "Structure requirements:").
  let core = template.template.replace(PLACEHOLDER_RE, (_match, key: string) => {
    if (key === PARAMS_PLACEHOLDER) return `{${PARAMS_PLACEHOLDER}}`;
    const value = values[key];
    return value === undefined || value === '' ? EMPTY_SLOT_MARK : value;
  });
  for (const prepend of actions.prepends) {
    core = `${prepend}${core}`;
  }
  for (const append of actions.appends) {
    core = `${core}${append}`;
  }
  for (const replacement of actions.replaces) {
    core = core.split(replacement.find).join(replacement.with);
  }
  core = tidyText(core);

  // 7. Объединение параметров.
  const params = mergeParams(template, values, actions, input.params ?? {});

  // 8. Негативный блок: negativeDefault шаблона + правила + текст пользователя.
  const negativeParts: string[] = [];
  if (template.negativeDefault !== undefined && template.negativeDefault.trim() !== '') {
    negativeParts.push(template.negativeDefault.trim());
  }
  negativeParts.push(...actions.negatives.map((part) => part.trim()).filter((p) => p !== ''));
  if (input.negative !== undefined && input.negative.trim() !== '') {
    negativeParts.push(input.negative.trim());
  }
  const negative = dedupeJoin(negativeParts);

  // 9. Итоговый текст.
  const prompt = composeFinal(template, core, params, negative);

  return {
    prompt,
    core,
    negative,
    params: Object.fromEntries(params),
    slots: values,
    template: template.id,
    type: template.type,
    platform: template.platform,
  };
}

/* ------------------------------------------------------------------ */
/* Слияние параметров                                                 */
/* ------------------------------------------------------------------ */

function mergeParams(
  template: Template,
  slotValues: Readonly<Record<string, string>>,
  actions: { params: Array<{ key: string; value: string }>; removals: string[] },
  userParams: Readonly<Record<string, string>>,
): Map<string, string> {
  const order: string[] = [];
  const values = new Map<string, string>();

  const upsert = (rawKey: string, value: string): void => {
    const canonical = canonicalParamKey(rawKey);
    const normalized = normalizeParamKey(canonical);
    const existingIndex = order.findIndex((key) => normalizeParamKey(key) === normalized);
    if (existingIndex >= 0) {
      const existingKey = order[existingIndex] ?? canonical;
      values.set(existingKey, value);
    } else {
      order.push(canonical);
      values.set(canonical, value);
    }
  };

  for (const [key, value] of Object.entries(template.defaults)) {
    upsert(key, value);
  }
  for (const slot of template.slots) {
    if (slot.param === undefined) continue;
    const value = slotValues[slot.key];
    if (value === undefined) continue;
    upsert(slot.param, value);
  }
  for (const { key, value } of actions.params) {
    upsert(key, value);
  }
  for (const [key, value] of Object.entries(userParams)) {
    upsert(key, value);
  }
  for (const removal of actions.removals) {
    const normalized = normalizeParamKey(removal);
    const index = order.findIndex((key) => normalizeParamKey(key) === normalized);
    if (index >= 0) {
      const removedKey = order[index];
      order.splice(index, 1);
      if (removedKey !== undefined) values.delete(removedKey);
    }
  }

  const merged = new Map<string, string>();
  for (const key of order) {
    const value = values.get(key);
    if (value !== undefined) merged.set(key, value);
  }
  return merged;
}

/* ------------------------------------------------------------------ */
/* Итоговый текст                                                     */
/* ------------------------------------------------------------------ */

function composeFinal(
  template: Template,
  core: string,
  params: Map<string, string>,
  negative: string | null,
): string {
  const format = template.negativeFormat;
  const inlineParams = renderInlineParams(params);

  if (format === 'sd-block') {
    const head = negative !== null ? `Negative prompt: ${negative}\n\n` : '';
    const paramLine = renderSdParams(params);
    return `${head}${core}${paramLine !== '' ? `\n${paramLine}` : ''}`;
  }

  let text: string;
  if (core.includes(`{${PARAMS_PLACEHOLDER}}`)) {
    text = tidyText(core.replace(new RegExp(`\\{${PARAMS_PLACEHOLDER}\\}`, 'g'), inlineParams));
  } else if (inlineParams !== '') {
    text = tidyText(`${core} ${inlineParams}`);
  } else {
    text = core;
  }

  if (negative !== null) {
    text =
      format === 'mj-no' ? `${text} --no ${negative}` : `${text}\n\nNegative prompt: ${negative}`;
  }
  return text.trim();
}

/* ------------------------------------------------------------------ */
/* Валидация значений слотов                                          */
/* ------------------------------------------------------------------ */

function validateSlotValue(template: Template, slot: Slot, value: string): void {
  if (slot.type === 'enum' && slot.options !== undefined) {
    if (!slot.options.includes(value)) {
      const caseInsensitive = slot.options.find(
        (option) => option.toLowerCase() === value.toLowerCase(),
      );
      if (caseInsensitive !== undefined) {
        throw new ValidationError(
          `Слот "${slot.key}" шаблона "${template.id}": значение "${value}" написано с ошибкой в регистре — имейте в виду ${caseInsensitive}. ` +
            `Допустимые значения: ${slot.options.join(', ')}.`,
          { field: slot.key, allowed: slot.options },
        );
      }
      throw new ValidationError(
        `Слот "${slot.key}" шаблона "${template.id}": недопустимое значение "${value}". Допустимые: ${slot.options.join(', ')}.`,
        { field: slot.key, allowed: slot.options },
      );
    }
    return;
  }
  if (slot.type === 'number' && !/^-?\d+(\.\d+)?$/.test(value)) {
    throw new ValidationError(
      `Слот "${slot.key}" шаблона "${template.id}": ожидается число, получено "${value}".`,
      { field: slot.key },
    );
  }
  if (slot.type === 'boolean' && !/^(true|false|yes|no|да|нет)$/i.test(value)) {
    throw new ValidationError(
      `Слот "${slot.key}" шаблона "${template.id}": ожидается true/false (либо да/нет), получено "${value}".`,
      { field: slot.key, allowed: ['true', 'false'] },
    );
  }
}

/* ------------------------------------------------------------------ */
/* Текстовые артефакты                                                */
/* ------------------------------------------------------------------ */

/**
 * Убирает артефакты подстановки пустых слотов: двойные пробелы, висячие запятые,
 * запятую перед параметром вида "--ar", строки-метки, потерявшие содержимое ("Style:.").
 * Не трогает переводы строк — многострочные промты сохраняют структуру.
 */
export function tidyText(text: string): string {
  const cleanedLines: string[] = [];
  for (const rawLine of text.split('\n')) {
    const hadEmptySlot = rawLine.includes(EMPTY_SLOT_MARK);
    let line = rawLine
      .split(EMPTY_SLOT_MARK)
      .join('')
      .replace(/[ \t]+/g, ' ');
    // Повторяющиеся запятые (в т.ч. после удаления пустых слотов).
    let previous: string;
    do {
      previous = line;
      line = line.replace(/\s*,\s*,/g, ',');
    } while (line !== previous);
    line = line.replace(/\s+,/g, ',').trim();
    // Запятая перед параметром "--flag" и запятая перед точкой — артефакты подстановки.
    line = line.replace(/,\s*(?=--)/g, ' ').replace(/,\s+\./g, '.');
    if (
      hadEmptySlot &&
      (/^[A-Za-zА-Яа-яЁё0-9][\w\s/.-]*:\s*[.!?]*$/.test(line) || /^[\s,.:;-]*$/.test(line))
    ) {
      // Строка целиком держалась на пустом слоте ("Style: ." / "Framework/runtime:") — убираем.
      continue;
    }
    line = line.replace(/[ \t]+$/, '').replace(/^[ \t]+/, '');
    line = line.replace(/,\s*$/, '');
    cleanedLines.push(line);
  }
  return cleanedLines
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

/** Склеивает фрагменты негативного блока, убирая дубли, через запятую. */
function dedupeJoin(parts: string[]): string | null {
  const seen = new Set<string>();
  const result: string[] = [];
  for (const part of parts) {
    for (const piece of part.split(',').map((p) => p.trim())) {
      const key = piece.toLowerCase();
      if (piece === '' || seen.has(key)) continue;
      seen.add(key);
      result.push(piece);
    }
  }
  return result.length > 0 ? result.join(', ') : null;
}
