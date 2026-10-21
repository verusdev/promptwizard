import { describe, expect, it } from 'vitest';
import {
  AnthropicMessagesResponseSchema,
  GenerateFlagsSchema,
  LlmProviderSchema,
  OpenAiChatResponseSchema,
  PromptTypeSchema,
  RuleWhenSchema,
  SlotSchema,
  TemplateSchema,
} from '../../src/lib/schemas.js';
import { ValidationError } from '../../src/lib/engine/errors.js';

describe('PromptTypeSchema и LlmProviderSchema', () => {
  it('допустимые типы промтов', () => {
    expect(PromptTypeSchema.parse('image')).toBe('image');
    expect(PromptTypeSchema.parse('code')).toBe('code');
    expect(PromptTypeSchema.parse('text')).toBe('text');
    expect(PromptTypeSchema.parse('video')).toBe('video');
    expect(PromptTypeSchema.parse('music')).toBe('music');
  });

  it('неизвестный тип → ошибка Zod', () => {
    expect(() => PromptTypeSchema.parse('audio')).toThrow();
  });

  it('провайдеры — только openai/anthropic', () => {
    expect(LlmProviderSchema.parse('openai')).toBe('openai');
    expect(LlmProviderSchema.parse('anthropic')).toBe('anthropic');
    expect(() => LlmProviderSchema.parse('gemini')).toThrow();
  });
});

describe('SlotSchema — валидация слотов', () => {
  it('минимальный слот валиден', () => {
    const slot = SlotSchema.parse({ key: 'subject', label: 'Сюжет' });
    expect(slot.required).toBe(false);
    expect(slot.type).toBe('string');
  });

  it('ключ слота должен быть в snake_case/kebab-case стиле', () => {
    expect(() => SlotSchema.parse({ key: 'Subject', label: 'x' })).toThrow();
    expect(() => SlotSchema.parse({ key: 'sub ject', label: 'x' })).toThrow();
    expect(SlotSchema.parse({ key: 'sub-ject_1', label: 'x' }).key).toBe('sub-ject_1');
  });

  it('enum: options обязателен', () => {
    expect(() => SlotSchema.parse({ key: 'style', label: 'Стиль', type: 'enum' })).toThrow(
      /options/,
    );
    expect(() =>
      SlotSchema.parse({ key: 'style', label: 'Стиль', type: 'enum', options: [] }),
    ).toThrow(/options/);
  });

  it('options допустимы только для enum', () => {
    expect(() =>
      SlotSchema.parse({ key: 'name', label: 'Имя', type: 'string', options: ['a'] }),
    ).toThrow(/options/);
  });

  it('default должен быть в options для enum', () => {
    expect(() =>
      SlotSchema.parse({
        key: 'style',
        label: 'Стиль',
        type: 'enum',
        options: ['a', 'b'],
        default: 'c',
      }),
    ).toThrow(/default.*options/);
  });

  it('strict: лишние поля запрещены', () => {
    expect(() => SlotSchema.parse({ key: 'x', label: 'X', unknown: true })).toThrow();
  });
});

describe('RuleWhenSchema', () => {
  it('пустое условие запрещено', () => {
    expect(() => RuleWhenSchema.parse({})).toThrow(/slot.*flag/);
  });

  it('слот без equals/notEquals/in разрешён («слот заполнен»)', () => {
    expect(RuleWhenSchema.parse({ slot: 'style' }).slot).toBe('style');
  });

  it('флаг разрешён', () => {
    expect(RuleWhenSchema.parse({ flag: 'negative' }).flag).toBe('negative');
  });

  it('equals/notEquals/in валидны', () => {
    expect(RuleWhenSchema.parse({ slot: 'lang', equals: 'go' }).equals).toBe('go');
    expect(RuleWhenSchema.parse({ slot: 'lang', notEquals: 'c' }).notEquals).toBe('c');
    expect(RuleWhenSchema.parse({ slot: 'lang', in: ['go', 'rust'] }).in).toEqual(['go', 'rust']);
  });

  it('in не может быть пустым', () => {
    expect(() => RuleWhenSchema.parse({ slot: 'lang', in: [] })).toThrow();
  });

  it('strict: лишние поля запрещены', () => {
    expect(() => RuleWhenSchema.parse({ slot: 'x', extra: 1 })).toThrow();
  });
});

describe('TemplateSchema', () => {
  const base = {
    id: 'test-tpl',
    type: 'image',
    platform: 'Test',
    name: 'Тест',
    description: 'Описание',
    template: '{subject}',
    examples: ['пример'],
  };

  it('базовый шаблон парсится', () => {
    const template = TemplateSchema.parse(base);
    expect(template.slots).toEqual([]);
    expect(template.rules).toEqual([]);
    expect(template.defaults).toEqual({});
    expect(template.negativeFormat).toBe('inline');
  });

  it('id должен быть в нижнем регистре с дефисами/цифрами', () => {
    expect(() => TemplateSchema.parse({ ...base, id: 'Test' })).toThrow();
    expect(() => TemplateSchema.parse({ ...base, id: 'test_too' })).toThrow();
    expect(TemplateSchema.parse({ ...base, id: 'test-123' }).id).toBe('test-123');
  });

  it('дублирующиеся ключи слотов → ошибка с путём', () => {
    expect(() =>
      TemplateSchema.parse({
        ...base,
        slots: [
          { key: 'x', label: 'X' },
          { key: 'x', label: 'X2' },
        ],
      }),
    ).toThrow(/Дублирующ/);
  });

  it('пример должен быть непустым', () => {
    expect(() => TemplateSchema.parse({ ...base, examples: [] })).toThrow();
    expect(() => TemplateSchema.parse({ ...base, examples: [''] })).toThrow();
  });

  it('strict: лишние поля запрещены', () => {
    expect(() => TemplateSchema.parse({ ...base, foo: 'bar' })).toThrow();
  });
});

describe('GenerateFlagsSchema — валидация ввода generate', () => {
  it('минимум: только type', () => {
    const flags = GenerateFlagsSchema.parse({ type: 'image' });
    expect(flags.params).toEqual([]);
    expect(flags.negative).toBe(false);
    expect(flags.copy).toBe(false);
    expect(flags.json).toBe(false);
    expect(flags.stdin).toBe(false);
    expect(flags.refine).toBe(false);
  });

  it('неверный тип → ошибка Zod', () => {
    expect(() => GenerateFlagsSchema.parse({ type: 'audio' })).toThrow();
  });

  it('строковые флаги обрезаются (trim)', () => {
    const flags = GenerateFlagsSchema.parse({ type: 'code', subject: '  hello  ' });
    expect(flags.subject).toBe('hello');
  });

  it('пустые строковые значения отклоняются', () => {
    expect(() => GenerateFlagsSchema.parse({ type: 'code', subject: '  ' })).toThrow();
    expect(() => GenerateFlagsSchema.parse({ type: 'code', platform: '' })).toThrow();
  });

  it('bool-флаги по умолчанию false', () => {
    const flags = GenerateFlagsSchema.parse({ type: 'text' });
    expect(flags.negative).toBe(false);
    expect(flags.copy).toBe(false);
  });

  it('strict: неизвестные флаги запрещены', () => {
    expect(() => GenerateFlagsSchema.parse({ type: 'image', unknownFlag: true })).toThrow();
  });

  it('params принимает массив строк (сырьё для парсинга ключ=значение)', () => {
    const flags = GenerateFlagsSchema.parse({ type: 'image', params: ['ar=16:9', 'v=6'] });
    expect(flags.params).toEqual(['ar=16:9', 'v=6']);
  });
});

describe('LLM-схемы ответов', () => {
  it('OpenAiChatResponseSchema требует choices[0].message.content', () => {
    expect(
      OpenAiChatResponseSchema.parse({
        choices: [{ message: { content: 'hello' } }],
      }).choices[0]?.message.content,
    ).toBe('hello');
    expect(
      OpenAiChatResponseSchema.parse({
        choices: [{ message: { content: null } }],
      }).choices[0]?.message.content,
    ).toBeNull();
    expect(() => OpenAiChatResponseSchema.parse({ choices: [] })).toThrow();
    expect(() => OpenAiChatResponseSchema.parse({ choices: [{ message: {} }] })).toThrow();
  });

  it('AnthropicMessagesResponseSchema требует массив content', () => {
    expect(
      AnthropicMessagesResponseSchema.parse({
        content: [
          { type: 'thought', text: '...' },
          { type: 'text', text: 'result' },
        ],
      }).content.length,
    ).toBe(2);
    expect(() => AnthropicMessagesResponseSchema.parse({ content: [] })).toThrow();
  });
});

describe('ValidationError совместимость (используется в командах)', () => {
  it('хранит field и allowed', () => {
    const error = new ValidationError('текст', { field: 'type', allowed: ['a', 'b'] });
    expect(error).toBeInstanceOf(Error);
    expect(error.field).toBe('type');
    expect(error.allowed).toEqual(['a', 'b']);
    expect(error.message).toBe('текст');
  });

  it('zod-ошибки можно преобразовать в человекочитаемое сообщение (как в командах)', () => {
    const result = GenerateFlagsSchema.safeParse({ type: 'bad' });
    expect(result.success).toBe(false);
    if (!result.success) {
      const details = result.error.issues
        .map((issue) => `параметр "${issue.path.join('.') || '?'}": ${issue.message}`)
        .join('; ');
      expect(details).toMatch(/параметр "type":/);
    }
  });
});
