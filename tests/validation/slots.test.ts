import type { z } from 'zod';
import { describe, expect, it } from 'vitest';
import { SlotSchema, type Slot } from '../../src/lib/schemas.js';
import { validateTextSlot } from '../../src/lib/validation/slots.js';

/**
 * MT12 — тесты вынесенной валидации слотов (src/lib/validation/slots.ts).
 *
 * Контракт зафиксирован на момент выноса логики из interactive.ts:
 * - пустое значение у required-слота → сообщение об обязательности;
 * - пустое значение у optional-слота → валидно (true);
 * - нечисловое значение у number-слота → сообщение «Ожидается число…»;
 * - string/enum/boolean с непустым значением → валидно (true).
 */

type SlotInput = z.input<typeof SlotSchema>;

/** Строит валидный слот через схему (применяются дефолты required/type). */
function makeSlot(overrides: Partial<SlotInput> = {}): Slot {
  return SlotSchema.parse({
    key: 'subject',
    label: 'Тема',
    type: 'string',
    required: true,
    ...overrides,
  });
}

const REQUIRED_MESSAGE =
  'Значение обязательно — введите текст или выберите слот без значения по умолчанию';
const NUMBER_MESSAGE = 'Ожидается число, например: 16 или 1.5';

/* ------------------------------------------------------------------ */
/* Обязательность (required / optional)                                */
/* ------------------------------------------------------------------ */

describe('validateTextSlot — обязательность значения', () => {
  it('required + пустая строка → сообщение об обязательности', () => {
    const slot = makeSlot({ required: true });
    expect(validateTextSlot(slot, '')).toBe(REQUIRED_MESSAGE);
  });

  it('required + строка из пробелов → сообщение об обязательности (значение trim-ается)', () => {
    const slot = makeSlot({ required: true });
    expect(validateTextSlot(slot, '   ')).toBe(REQUIRED_MESSAGE);
    expect(validateTextSlot(slot, '\t\n ')).toBe(REQUIRED_MESSAGE);
  });

  it('optional + пустая строка → валидно', () => {
    const slot = makeSlot({ required: false });
    expect(validateTextSlot(slot, '')).toBe(true);
  });

  it('optional + строка из пробелов → валидно', () => {
    const slot = makeSlot({ required: false });
    expect(validateTextSlot(slot, '   ')).toBe(true);
  });

  it('required + непустое значение → валидно', () => {
    const slot = makeSlot({ required: true });
    expect(validateTextSlot(slot, 'кот в шляпе')).toBe(true);
  });

  it('default в слоте не делает значение обязательным', () => {
    const slot = makeSlot({ required: false, default: '16:9' });
    expect(validateTextSlot(slot, '')).toBe(true);
  });
});

/* ------------------------------------------------------------------ */
/* Числовые слоты                                                      */
/* ------------------------------------------------------------------ */

describe('validateTextSlot — числовые слоты', () => {
  const numberSlot = makeSlot({ key: 'ratio', label: 'Соотношение', type: 'number' });

  it('number + нечисловое значение → сообщение «Ожидается число…»', () => {
    expect(validateTextSlot(numberSlot, 'abc')).toBe(NUMBER_MESSAGE);
    expect(validateTextSlot(numberSlot, '16:9')).toBe(NUMBER_MESSAGE);
    expect(validateTextSlot(numberSlot, '1.5.2')).toBe(NUMBER_MESSAGE);
    expect(validateTextSlot(numberSlot, '1e3')).toBe(NUMBER_MESSAGE);
    expect(validateTextSlot(numberSlot, '+5')).toBe(NUMBER_MESSAGE);
    expect(validateTextSlot(numberSlot, '5px')).toBe(NUMBER_MESSAGE);
    expect(validateTextSlot(numberSlot, '1.')).toBe(NUMBER_MESSAGE);
  });

  it('number + целое → валидно', () => {
    expect(validateTextSlot(numberSlot, '16')).toBe(true);
    expect(validateTextSlot(numberSlot, '0')).toBe(true);
  });

  it('number + дробное → валидно', () => {
    expect(validateTextSlot(numberSlot, '1.5')).toBe(true);
    expect(validateTextSlot(numberSlot, '0.25')).toBe(true);
  });

  it('number + отрицательное → валидно', () => {
    expect(validateTextSlot(numberSlot, '-3')).toBe(true);
    expect(validateTextSlot(numberSlot, '-0.5')).toBe(true);
  });

  it('number + пробелы вокруг значения → валидно (trim)', () => {
    expect(validateTextSlot(numberSlot, '  16  ')).toBe(true);
  });

  it('number + пустое значение → проверка обязательности, а не формата', () => {
    const requiredNumber = makeSlot({
      key: 'ratio',
      label: 'Соотношение',
      type: 'number',
      required: true,
    });
    expect(validateTextSlot(requiredNumber, '')).toBe(REQUIRED_MESSAGE);

    const optionalNumber = makeSlot({
      key: 'ratio',
      label: 'Соотношение',
      type: 'number',
      required: false,
    });
    expect(validateTextSlot(optionalNumber, '')).toBe(true);
  });
});

/* ------------------------------------------------------------------ */
/* Строковые, enum и boolean слоты                                     */
/* ------------------------------------------------------------------ */

describe('validateTextSlot — string / enum / boolean', () => {
  it('string + непустое значение → валидно', () => {
    const slot = makeSlot({ type: 'string' });
    expect(validateTextSlot(slot, 'кот в шляпе')).toBe(true);
    expect(validateTextSlot(slot, '0')).toBe(true);
  });

  it('enum + непустое значение → валидно', () => {
    const slot = makeSlot({
      key: 'style',
      label: 'Стиль',
      type: 'enum',
      options: ['photo', 'illustration'],
    });
    expect(validateTextSlot(slot, 'photo')).toBe(true);
    expect(validateTextSlot(slot, 'illustration')).toBe(true);
  });

  it('enum + пустое значение → по обязательности слота', () => {
    const requiredEnum = makeSlot({
      key: 'style',
      label: 'Стиль',
      type: 'enum',
      options: ['photo'],
      required: true,
    });
    expect(validateTextSlot(requiredEnum, '')).toBe(REQUIRED_MESSAGE);

    const optionalEnum = makeSlot({
      key: 'style',
      label: 'Стиль',
      type: 'enum',
      options: ['photo'],
      required: false,
    });
    expect(validateTextSlot(optionalEnum, '')).toBe(true);
  });

  it('boolean + непустое значение → валидно', () => {
    const slot = makeSlot({ key: 'negative', label: 'Негатив', type: 'boolean' });
    expect(validateTextSlot(slot, 'true')).toBe(true);
    expect(validateTextSlot(slot, 'false')).toBe(true);
    expect(validateTextSlot(slot, 'да')).toBe(true);
  });

  it('boolean + пустое значение → по обязательности слота', () => {
    const requiredBoolean = makeSlot({
      key: 'negative',
      label: 'Негатив',
      type: 'boolean',
      required: true,
    });
    expect(validateTextSlot(requiredBoolean, '')).toBe(REQUIRED_MESSAGE);

    const optionalBoolean = makeSlot({
      key: 'negative',
      label: 'Негатив',
      type: 'boolean',
      required: false,
    });
    expect(validateTextSlot(optionalBoolean, '')).toBe(true);
  });
});

/* ------------------------------------------------------------------ */
/* Форма возвращаемого значения                                        */
/* ------------------------------------------------------------------ */

describe('validateTextSlot — форма результата', () => {
  it('успех — строго true (не пустая строка)', () => {
    const slot = makeSlot({ type: 'string' });
    const result = validateTextSlot(slot, 'значение');
    expect(result).toBe(true);
    expect(typeof result).toBe('boolean');
  });

  it('ошибка — строка с человекочитаемым сообщением (без stack trace)', () => {
    const slot = makeSlot({ type: 'number' });
    const result = validateTextSlot(slot, 'abc');
    expect(typeof result).toBe('string');
    expect(result).not.toMatch(/^\s+at\s+\S/m);
    expect(result).not.toContain('Error:');
  });

  it('валидация детерминирована: одинаковый вход → одинаковый результат', () => {
    const slot = makeSlot({ type: 'number' });
    expect(validateTextSlot(slot, 'abc')).toBe(validateTextSlot(slot, 'abc'));
    expect(validateTextSlot(slot, '16')).toBe(validateTextSlot(slot, '16'));
  });
});
