import { z } from 'zod';

/* ------------------------------------------------------------------ */
/* Базовые доменные типы                                              */
/* ------------------------------------------------------------------ */

/** Пять типов промтов MVP. */
export const PROMPT_TYPES = ['image', 'code', 'text', 'video', 'music'] as const;
export const PromptTypeSchema = z.enum(PROMPT_TYPES);
export type PromptType = z.infer<typeof PromptTypeSchema>;

/** LLM-провайдеры (используются в конфиге; реализация — Milestone M4). */
export const LLM_PROVIDERS = ['openai', 'anthropic'] as const;
export const LlmProviderSchema = z.enum(LLM_PROVIDERS);
export type LlmProvider = z.infer<typeof LlmProviderSchema>;

/** Приводит строку к «slug-форме» для сравнения: "Stable Diffusion" → "stable-diffusion". */
export function platformSlug(platform: string): string {
  return platform
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

/* ------------------------------------------------------------------ */
/* Схемы шаблонов (§7 PLAN.md)                                        */
/* ------------------------------------------------------------------ */

export const SLOT_VALUE_TYPES = ['string', 'number', 'enum', 'boolean'] as const;

/** Описание слота шаблона — заполняется пользователем (флаги/интерактив). */
export const SlotSchema = z
  .object({
    key: z
      .string()
      .regex(/^[a-z][a-z0-9_-]*$/, 'Ключ слота: строчные буквы, цифры, дефис/подчёркивание'),
    label: z.string().min(1, 'У слота должно быть человекочитаемое название (label)'),
    description: z.string().optional(),
    required: z.boolean().default(false),
    type: z.enum(SLOT_VALUE_TYPES).default('string'),
    /** Обязателен для type="enum": список допустимых значений. */
    options: z.array(z.string().min(1)).min(1).optional(),
    /** Значение по умолчанию (используется, если слот не передан). */
    default: z.string().optional(),
    /** Если задано — значение слота попадает в блок параметров как "<param> <значение>" (например "--ar"). */
    param: z.string().optional(),
  })
  .strict()
  .superRefine((slot, ctx) => {
    if (slot.type === 'enum' && (!slot.options || slot.options.length === 0)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['options'],
        message: `Слот "${slot.key}": для type="enum" обязателен непустой массив options`,
      });
    }
    if (slot.type !== 'enum' && slot.options !== undefined && slot.options.length > 0) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['options'],
        message: `Слот "${slot.key}": options допустимы только для type="enum"`,
      });
    }
    if (
      slot.default !== undefined &&
      slot.type === 'enum' &&
      slot.options &&
      !slot.options.includes(slot.default)
    ) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['default'],
        message: `Слот "${slot.key}": default "${slot.default}" отсутствует среди options`,
      });
    }
  });

export type Slot = z.infer<typeof SlotSchema>;

/** Условие применения правила: slot (equals/notEquals/in) и/или flag.
 *  Условие только с slot (без equals/notEquals/in) означает «слот заполнен». */
export const RuleWhenSchema = z
  .object({
    slot: z.string().min(1).optional(),
    equals: z.string().optional(),
    notEquals: z.string().optional(),
    in: z.array(z.string().min(1)).min(1).optional(),
    /** Имя флага (например "negative"): срабатывает, когда флаг включён. */
    flag: z.string().min(1).optional(),
  })
  .strict()
  .refine((when) => when.slot !== undefined || when.flag !== undefined, {
    message: 'Условие (when) должно ссылаться на slot и/или flag',
  })
  .refine(
    (when) =>
      when.flag !== undefined ||
      when.slot !== undefined ||
      when.equals !== undefined ||
      when.notEquals !== undefined ||
      when.in !== undefined,
    { message: 'Пустое условие (when) не допускается' },
  );

export type RuleWhen = z.infer<typeof RuleWhenSchema>;

/** Правило сборки: условие + действие (append/prepend/replace/negative/параметры). */
export const RuleSchema = z
  .object({
    description: z.string().optional(),
    when: RuleWhenSchema.optional(),
    /** Добавить строку в конец основной части промта (разделитель пишет автор шаблона). */
    append: z.string().optional(),
    /** Добавить строку в начало основной части промта. */
    prepend: z.string().optional(),
    /** Точечная замена подстроки в собранном тексте (детерминированно, не regex). */
    replace: z
      .object({ find: z.string().min(1), with: z.string() })
      .strict()
      .optional(),
    /** Добавить фрагмент в негативный блок. */
    negative: z.string().optional(),
    /** Установить/перезаписать параметр (ключ вида "--ar" или "ar"). */
    setParam: z.record(z.string()).optional(),
    /** Убрать параметры (ключи вида "--ar" или "ar"). */
    removeParam: z.array(z.string().min(1)).optional(),
  })
  .strict()
  .refine(
    (rule) =>
      rule.append !== undefined ||
      rule.prepend !== undefined ||
      rule.replace !== undefined ||
      rule.negative !== undefined ||
      rule.setParam !== undefined ||
      rule.removeParam !== undefined,
    { message: 'Правило должно содержать хотя бы одно действие' },
  );

export type Rule = z.infer<typeof RuleSchema>;

/** Формат итогового промта с учётом негативного блока. */
export const NEGATIVE_FORMATS = ['inline', 'mj-no', 'sd-block'] as const;
export const NegativeFormatSchema = z.enum(NEGATIVE_FORMATS);
export type NegativeFormat = z.infer<typeof NegativeFormatSchema>;

/** Шаблон промта — JSON-файл из базы знаний (src/templates/<тип>/<id>.json). */
export const TemplateSchema = z
  .object({
    id: z.string().regex(/^[a-z0-9][a-z0-9-]*$/, 'id шаблона: строчные буквы, цифры, дефисы'),
    type: PromptTypeSchema,
    /** Человекочитаемое имя платформы, например "Midjourney". */
    platform: z.string().min(1),
    name: z.string().min(1),
    description: z.string().min(1),
    slots: z.array(SlotSchema).default([]),
    /**
     * Шаблонная строка. Плейсхолдеры: {key} — слоты, {params} — блок параметров.
     * Подстановка только известных слотов; пустые необязательные слоты убираются
     * вместе с висячими разделителями.
     */
    template: z.string().min(1),
    rules: z.array(RuleSchema).default([]),
    /** Базовые параметры (например {"--ar": "16:9"}); перекрываются слотами и --param. */
    defaults: z.record(z.string()).default({}),
    /** Базовый негативный блок (например для Stable Diffusion) — включается всегда. */
    negativeDefault: z.string().optional(),
    /** Как собирать итоговый текст с негативом: inline / mj-no (--no) / sd-block. */
    negativeFormat: NegativeFormatSchema.default('inline'),
    /** 1–2 готовых примера промта для этой платформы. */
    examples: z.array(z.string().min(1)).min(1),
  })
  .strict()
  .superRefine((template, ctx) => {
    const seen = new Set<string>();
    template.slots.forEach((slot, index) => {
      if (seen.has(slot.key)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['slots', index, 'key'],
          message: `Дублирующийся ключ слота "${slot.key}"`,
        });
      }
      seen.add(slot.key);
    });
  });

export type Template = z.infer<typeof TemplateSchema>;

/* ------------------------------------------------------------------ */
/* Конфигурация                                                       */
/* ------------------------------------------------------------------ */

/** Секция LLM в rc-файле (все поля необязательные). */
export const LlmConfigFileSchema = z
  .object({
    provider: LlmProviderSchema.optional(),
    apiKey: z.string().min(1).optional(),
    baseUrl: z.string().url('baseUrl должен быть корректным URL').optional(),
    model: z.string().min(1).optional(),
  })
  .strict();

/** Формат rc-файла (.promptwizardrc.json/yaml или ключ "promptwizard" в package.json). */
export const ConfigFileSchema = z
  .object({
    llm: LlmConfigFileSchema.optional(),
  })
  .strict();

export type ConfigFile = z.infer<typeof ConfigFileSchema>;

/** Эффективная конфигурация после слияния: env > файл > дефолты. */
export const ConfigSchema = z.object({
  llm: z
    .object({
      provider: LlmProviderSchema.default('openai'),
      apiKey: z.string().nullable().default(null),
      baseUrl: z.string().nullable().default(null),
      model: z.string().nullable().default(null),
    })
    .default({}),
});

export type Config = z.infer<typeof ConfigSchema>;

export const DEFAULT_CONFIG: Config = ConfigSchema.parse({});

/* ------------------------------------------------------------------ */
/* Ответы LLM API (валидация на границе сети)                          */
/* ------------------------------------------------------------------ */

/** Ответ OpenAI-совместимого /chat/completions (важны choices[0].message.content). */
export const OpenAiChatResponseSchema = z.object({
  choices: z
    .array(
      z.object({
        message: z.object({
          content: z.string().nullable(),
        }),
      }),
    )
    .min(1),
});

/** Ответ Anthropic /v1/messages (важен блок content с типом "text"). */
export const AnthropicMessagesResponseSchema = z.object({
  content: z
    .array(
      z.object({
        type: z.string(),
        text: z.string().optional(),
      }),
    )
    .min(1),
});

/* ------------------------------------------------------------------ */
/* Флаги команд (валидация ввода на границе)                          */
/* ------------------------------------------------------------------ */

/** Необработанные флаги команды generate (до разбора --param). */
export const GenerateFlagsSchema = z
  .object({
    type: PromptTypeSchema,
    platform: z.string().trim().min(1).optional(),
    subject: z.string().trim().min(1).optional(),
    style: z.string().trim().min(1).optional(),
    /** Сырые значения повторяемого флага --param (формат "ключ=значение"). */
    params: z.array(z.string()).default([]),
    negative: z.boolean().default(false),
    out: z.string().trim().min(1).optional(),
    copy: z.boolean().default(false),
    json: z.boolean().default(false),
    stdin: z.boolean().default(false),
    refine: z.boolean().default(false),
  })
  .strict();

export type GenerateFlags = z.infer<typeof GenerateFlagsSchema>;
