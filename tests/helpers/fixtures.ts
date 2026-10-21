import type { z } from 'zod';
import { TemplateSchema, type Template } from '../../src/lib/schemas.js';

/** Вход для TemplateSchema (то, что принимает parse). */
export type TemplateInput = z.input<typeof TemplateSchema>;

/**
 * Фикстура валидного шаблона: минимально допустимый базис + overrides.
 * Все тестовые шаблоны собираются через неё — схема гарантирует валидность.
 */
export function makeTemplate(overrides: Partial<TemplateInput> = {}): Template {
  return TemplateSchema.parse({
    id: 'fixture',
    type: 'image',
    platform: 'Fixture Platform',
    name: 'Тестовый шаблон',
    description: 'Фикстура для юнит-тестов движка',
    template: '{subject}',
    examples: ['пример'],
    ...overrides,
  });
}
