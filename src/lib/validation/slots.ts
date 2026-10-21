import type { Slot } from '../schemas.js';

const NUMBER_RE = /^-?\d+(\.\d+)?$/;

export function validateTextSlot(slot: Slot, raw: string): true | string {
  const value = raw.trim();
  if (value === '') {
    return slot.required
      ? 'Значение обязательно — введите текст или выберите слот без значения по умолчанию'
      : true;
  }
  if (slot.type === 'number' && !NUMBER_RE.test(value)) {
    return 'Ожидается число, например: 16 или 1.5';
  }
  return true;
}
