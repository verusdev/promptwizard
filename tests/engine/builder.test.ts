import { describe, expect, it } from 'vitest';
import { buildPrompt, tidyText } from '../../src/lib/engine/builder.js';
import { BuildError, ValidationError } from '../../src/lib/engine/errors.js';
import { TemplateSchema, type Template } from '../../src/lib/schemas.js';
import { makeTemplate } from '../helpers/fixtures.js';
import midjourneyJson from '../../src/templates/image/midjourney.json';
import stableDiffusionJson from '../../src/templates/image/stable-diffusion.json';
import genericLlmJson from '../../src/templates/code/generic-llm.json';
import articleJson from '../../src/templates/text/article.json';

const midjourney = TemplateSchema.parse(midjourneyJson);
const stableDiffusion = TemplateSchema.parse(stableDiffusionJson);
const genericLlm = TemplateSchema.parse(genericLlmJson);
const article = TemplateSchema.parse(articleJson);

/* ------------------------------------------------------------------ */
/* Подстановка слотов                                                  */
/* ------------------------------------------------------------------ */

describe('buildPrompt — подстановка слотов', () => {
  it('обязательный слот подставляется в текст и попадает в result.slots', () => {
    const template = makeTemplate({ template: '{subject}, bright' });
    const result = buildPrompt(template, { slots: { subject: 'кот на крыше' } });

    expect(result.core).toBe('кот на крыше, bright');
    expect(result.slots).toEqual({ subject: 'кот на крыше' });
  });

  it('незаполненный обязательный слот → BuildError с именем слота и метаданными', () => {
    const template = makeTemplate();
    expect.assertions(4);
    try {
      buildPrompt(template, {});
    } catch (error) {
      expect(error).toBeInstanceOf(BuildError);
      const buildError = error as BuildError;
      expect(buildError.message).toMatch(/Не заполнен обязательный слот "subject"/);
      expect(buildError.slot).toBe('subject');
      expect(buildError.templateId).toBe('fixture');
    }
  });

  it('обязательный слот, заполненный пробелами, считается незаполненным', () => {
    const template = makeTemplate();
    expect(() => buildPrompt(template, { slots: { subject: '   ' } })).toThrow(BuildError);
  });

  it('необязательный пустой слот удаляется вместе с висящей запятой', () => {
    const template = makeTemplate({ template: '{subject}, {style}' });
    const result = buildPrompt(template, { slots: { subject: 'кот' } });
    expect(result.core).toBe('кот');
    expect(result.slots).toEqual({ subject: 'кот' });
  });

  it('значение по умолчанию слота используется, если слот не передан', () => {
    const template = makeTemplate({
      slots: [{ key: 'tone', label: 'Тон', type: 'enum', options: ['a', 'b'], default: 'b' }],
      template: 'Tone: {tone}',
    });
    const result = buildPrompt(template, {});
    expect(result.core).toBe('Tone: b');
    expect(result.slots).toEqual({ tone: 'b' });
  });

  it('обязательный слот с default не падает — default покрывает требование', () => {
    const template = makeTemplate({
      slots: [{ key: 'lang', label: 'Язык', required: true, default: 'русском' }],
      template: 'На {lang}',
    });
    expect(buildPrompt(template, {}).core).toBe('На русском');
  });

  it('неизвестный слот → BuildError со списком допустимых слотов', () => {
    const template = makeTemplate();
    expect.assertions(3);
    try {
      buildPrompt(template, { slots: { subj: 'x' } });
    } catch (error) {
      expect(error).toBeInstanceOf(BuildError);
      const buildError = error as BuildError;
      expect(buildError.message).toMatch(/Неизвестный слот "subj"/);
      expect(buildError.allowedSlots).toEqual(['subject']);
    }
  });

  it('шаблон со ссылкой на неизвестный слот → BuildError (ловит автора шаблона)', () => {
    const template = makeTemplate({
      template: '{subject}, {nonexistent}',
    });
    expect(() => buildPrompt(template, { slots: { subject: 'x' } })).toThrow(
      /Не заполнен обязательный слот|ссылается на неизвестный слот/,
    );
  });
});

/* ------------------------------------------------------------------ */
/* Валидация значений слотов                                           */
/* ------------------------------------------------------------------ */

describe('buildPrompt — валидация значений слотов', () => {
  const enumTemplate = (options: string[]): Template =>
    makeTemplate({
      slots: [{ key: 'style', label: 'Стиль', type: 'enum', options }],
      template: 'Style: {style}',
    });

  it('enum: допустимое значение проходит', () => {
    const result = buildPrompt(enumTemplate(['cinematic', 'anime']), {
      slots: { style: 'anime' },
    });
    expect(result.core).toBe('Style: anime');
  });

  it('enum: недопустимое значение → ValidationError со списком допустимых', () => {
    const template = enumTemplate(['cinematic', 'anime']);
    expect.assertions(4);
    try {
      buildPrompt(template, { slots: { style: 'watercolor' } });
    } catch (error) {
      expect(error).toBeInstanceOf(ValidationError);
      const validationError = error as ValidationError;
      expect(validationError.field).toBe('style');
      expect(validationError.allowed).toEqual(['cinematic', 'anime']);
      expect(validationError.message).toMatch(/недопустимое значение "watercolor"/);
    }
  });

  it('enum: значение «не в том регистре» → ValidationError с подсказкой', () => {
    const template = enumTemplate(['cinematic', 'anime']);
    expect.assertions(2);
    try {
      buildPrompt(template, { slots: { style: 'Cinematic' } });
    } catch (error) {
      expect(error).toBeInstanceOf(ValidationError);
      expect((error as ValidationError).message).toMatch(/регистре/);
    }
  });

  it('number: нечисловое значение → ValidationError «ожидается число»', () => {
    const template = makeTemplate({
      slots: [{ key: 'steps', label: 'Steps', type: 'number' }],
      template: 'Steps {steps}',
    });
    expect(() => buildPrompt(template, { slots: { steps: 'abc' } })).toThrow(/ожидается число/);
    expect(buildPrompt(template, { slots: { steps: '-1.5' } }).core).toBe('Steps -1.5');
  });

  it('boolean: «maybe» → ValidationError; «да»/«true» — допустимы', () => {
    const template = makeTemplate({
      slots: [{ key: 'hd', label: 'HD', type: 'boolean' }],
      template: 'HD: {hd}',
    });
    expect(() => buildPrompt(template, { slots: { hd: 'maybe' } })).toThrow(
      /ожидается true\/false/,
    );
    expect(buildPrompt(template, { slots: { hd: 'да' } }).core).toBe('HD: да');
    expect(buildPrompt(template, { slots: { hd: 'true' } }).core).toBe('HD: true');
  });
});

/* ------------------------------------------------------------------ */
/* Параметры: defaults → слоты → правила → пользовательские            */
/* ------------------------------------------------------------------ */

describe('buildPrompt — слияние параметров', () => {
  const paramTemplate = (): Template =>
    makeTemplate({
      slots: [
        { key: 'subject', label: 'Сюжет', required: true },
        { key: 'aspect', label: 'Формат', type: 'enum', options: ['16:9', '1:1'], param: '--ar' },
      ],
      template: '{subject} {params}',
      defaults: { '--ar': '16:9', '--v': '6' },
    });

  it('порядок приоритета: defaults < слот с param < пользовательский --param', () => {
    const result = buildPrompt(paramTemplate(), {
      slots: { subject: 'x', aspect: '1:1' },
      params: { ar: '2:1' },
    });
    // Слот перекрыл default, пользователь — слот; позиция ключа сохранена.
    expect(result.params).toEqual({ '--ar': '2:1', '--v': '6' });
    expect(result.prompt).toBe('x --ar 2:1 --v 6');
  });

  it('ключ канонизируется: "ar" и "--AR" бьются в один параметр "--ar"', () => {
    const result = buildPrompt(paramTemplate(), {
      slots: { subject: 'x' },
      params: { '--AR': '3:2', ar: '4:3' },
    });
    // Последнее присваивание выигрывает, дублей нет.
    expect(result.params).toEqual({ '--ar': '4:3', '--v': '6' });
  });

  it('новый пользовательский параметр добавляется после defaults', () => {
    const result = buildPrompt(paramTemplate(), {
      slots: { subject: 'x' },
      params: { '--stylize': '100' },
    });
    expect(Object.keys(result.params)).toEqual(['--ar', '--v', '--stylize']);
    expect(result.prompt).toBe('x --ar 16:9 --v 6 --stylize 100');
  });

  it('{params} в середине шаблона заменяется на блок параметров', () => {
    const template = makeTemplate({
      slots: [{ key: 'subject', label: 'Сюжет', required: true }],
      template: '[{params}] {subject}',
      defaults: { '--ar': '16:9' },
    });
    expect(buildPrompt(template, { slots: { subject: 'x' } }).prompt).toBe('[--ar 16:9] x');
  });

  it('setParam правила перекрывает default, но проигрывает пользователю', () => {
    const template = makeTemplate({
      template: '{subject} {params}',
      rules: [{ setParam: { '--ar': '3:2' } }],
      defaults: { '--ar': '16:9' },
    });
    expect(buildPrompt(template, { slots: { subject: 'x' } }).params).toEqual({ '--ar': '3:2' });
    expect(
      buildPrompt(template, { slots: { subject: 'x' }, params: { ar: '4:3' } }).params,
    ).toEqual({ '--ar': '4:3' });
  });

  it('removeParam правила убирает параметр из итогового набора', () => {
    const template = makeTemplate({
      slots: [{ key: 'aspect', label: 'Формат', type: 'enum', options: ['16:9'], param: '--ar' }],
      template: '{aspect} {params}',
      rules: [{ when: { slot: 'aspect' }, removeParam: ['v'] }],
      defaults: { '--ar': '16:9', '--v': '6' },
    });
    const result = buildPrompt(template, { slots: { aspect: '16:9' } });
    expect(result.params).toEqual({ '--ar': '16:9' });
    expect(result.prompt).toBe('16:9 --ar 16:9');
  });
});

/* ------------------------------------------------------------------ */
/* Правила: append / prepend / replace                                 */
/* ------------------------------------------------------------------ */

describe('buildPrompt — применение правил', () => {
  it('append/prepend/replace применяются при совпадении условия', () => {
    const template = makeTemplate({
      template: '{animal}',
      rules: [
        { when: { slot: 'animal', equals: 'кот' }, append: ', мурлыкает' },
        { when: { slot: 'animal', equals: 'кот' }, prepend: 'Смотрите: ' },
        { when: { slot: 'animal', equals: 'кот' }, replace: { find: 'кот', with: 'пёс' } },
      ],
    });
    const result = buildPrompt(template, { slots: { animal: 'кот и ещё кот' } });
    // replace применяется после prepend/append и заменяет все вхождения.
    expect(result.core).toBe('Смотрите: пёс и ещё пёс, мурлыкает');
  });

  it('несовпавшееся условие не добавляет действий', () => {
    const template = makeTemplate({
      template: '{animal}',
      rules: [{ when: { slot: 'animal', equals: 'тигр' }, append: ', рычит' }],
    });
    expect(buildPrompt(template, { slots: { animal: 'кот' } }).core).toBe('кот');
  });
});

/* ------------------------------------------------------------------ */
/* Негативный блок и форматы вывода                                    */
/* ------------------------------------------------------------------ */

describe('buildPrompt — негативный блок', () => {
  const sdFixture = (): Template =>
    makeTemplate({
      template: '{subject}',
      defaults: { '--steps': '28', '--sampler': 'Euler a', '--cfg': '7', '--seed': '-1' },
      negativeDefault: 'blurry, low quality',
      negativeFormat: 'sd-block',
      rules: [{ when: { flag: 'negative' }, negative: 'blurry, watermark' }],
    });

  it('sd-block: негатив сверху + core + параметры блоком в фиксированном порядке', () => {
    const result = buildPrompt(sdFixture(), { slots: { subject: 'city' } });
    expect(result.prompt).toBe(
      'Negative prompt: blurry, low quality\n\n' +
        'city\n' +
        'Steps: 28, Sampler: Euler a, CFG scale: 7, Seed: -1',
    );
    expect(result.negative).toBe('blurry, low quality');
  });

  it('sd-block: флаг negative добавляет фрагмент правила, дубли отсекаются', () => {
    const result = buildPrompt(sdFixture(), {
      slots: { subject: 'city' },
      flags: { negative: true },
      negative: 'LOW QUALITY, noise',
    });
    // negativeDefault + rule + пользователь; дубль «low quality» (без учета регистра) — один раз.
    expect(result.negative).toBe('blurry, low quality, watermark, noise');
  });

  it('sd-block без единого негативного фрагмента — без заголовка Negative prompt', () => {
    const template = makeTemplate({
      slots: [{ key: 'subject', label: 'Сюжет', required: true }],
      template: '{subject}',
      negativeFormat: 'sd-block',
      defaults: { '--seed': '7' },
    });
    const result = buildPrompt(template, { slots: { subject: 'x' } });
    expect(result.prompt).toBe('x\nSeed: 7');
    expect(result.negative).toBeNull();
  });

  it('mj-no: негатив добавляется как «--no …» в конец', () => {
    const template = makeTemplate({
      slots: [{ key: 'subject', label: 'Сюжет', required: true }],
      template: '{subject}',
      negativeFormat: 'mj-no',
      rules: [{ when: { flag: 'negative' }, negative: 'blurry, watermark' }],
      defaults: { '--ar': '16:9' },
    });
    const result = buildPrompt(template, {
      slots: { subject: 'lighthouse' },
      flags: { negative: true },
    });
    expect(result.prompt).toBe('lighthouse --ar 16:9 --no blurry, watermark');
  });

  it('inline (формат по умолчанию): негатив через пустую строку', () => {
    const template = makeTemplate({
      slots: [{ key: 'subject', label: 'Сюжет', required: true }],
      template: '{subject}',
      rules: [{ when: { flag: 'negative' }, negative: 'ugly' }],
    });
    const result = buildPrompt(template, { slots: { subject: 'x' }, flags: { negative: true } });
    expect(result.prompt).toBe('x\n\nNegative prompt: ugly');
    expect(result.negative).toBe('ugly');
  });

  it('flags.negative=false → правило с when.flag не срабатывает', () => {
    const template = makeTemplate({
      slots: [{ key: 'subject', label: 'Сюжет', required: true }],
      template: '{subject}',
      rules: [{ when: { flag: 'negative' }, negative: 'ugly' }],
    });
    const result = buildPrompt(template, { slots: { subject: 'x' }, flags: { negative: false } });
    expect(result.negative).toBeNull();
    expect(result.prompt).toBe('x');
  });
});

/* ------------------------------------------------------------------ */
/* Детерминированность и метаданные                                     */
/* ------------------------------------------------------------------ */

describe('buildPrompt — детерминированность и метаданные', () => {
  it('одинаковый вход → одинаковый выход', () => {
    const template = makeTemplate({
      slots: [
        { key: 'subject', label: 'Сюжет', required: true },
        { key: 'style', label: 'Стиль', type: 'enum', options: ['anime', 'other'] },
      ],
      template: '{subject}, {style} {params}',
      rules: [{ when: { slot: 'style', equals: 'anime' }, append: ', line art' }],
      defaults: { '--v': '6' },
    });
    const input = { slots: { subject: 'кот', style: 'anime' }, flags: { negative: false } };
    const first = buildPrompt(template, input);
    const second = buildPrompt(template, input);
    expect(JSON.stringify(first)).toBe(JSON.stringify(second));
  });

  it('результат несёт метаданные шаблона', () => {
    const template = makeTemplate({
      id: 'meta-check',
      type: 'video',
      platform: 'Meta',
      slots: [{ key: 'subject', label: 'Сюжет', required: true }],
      template: '{subject}',
    });
    const result = buildPrompt(template, { slots: { subject: 'x' } });
    expect(result.template).toBe('meta-check');
    expect(result.type).toBe('video');
    expect(result.platform).toBe('Meta');
  });
});

/* ------------------------------------------------------------------ */
/* tidyText                                                            */
/* ------------------------------------------------------------------ */

describe('tidyText — чистка артефактов подстановки', () => {
  it('схлопывает повторяющиеся запятые', () => {
    expect(tidyText('a, , , b')).toBe('a, b');
  });

  it('убирает запятую перед параметром "--flag"', () => {
    expect(tidyText('city, --ar 16:9')).toBe('city --ar 16:9');
  });

  it('схлопывает три и более переводов строки в один пустой', () => {
    expect(tidyText('a\n\n\n\nb')).toBe('a\n\nb');
  });

  it('не трогает структуру многострочного текста', () => {
    const text = 'line1\n\nline2: value\n- item';
    expect(tidyText(text)).toBe(text);
  });
});

/* ------------------------------------------------------------------ */
/* Реальные шаблоны базы (smoke T07: детерминированный результат)      */
/* ------------------------------------------------------------------ */

describe('buildPrompt — реальные шаблоны базы знаний', () => {
  it('midjourney: сборка воспроизводит пример шаблона', () => {
    const result = buildPrompt(midjourney, {
      slots: {
        subject: 'a cyberpunk city street at night',
        style: 'cinematic',
        lighting: 'neon lighting',
        camera: 'low angle',
      },
    });
    expect(result.prompt).toBe(midjourney.examples[0]);
  });

  it('stable-diffusion: sd-block собирается из negativeDefault + правил + параметров', () => {
    const result = buildPrompt(stableDiffusion, {
      slots: {
        subject: 'a cyberpunk city street in the rain',
        style: 'photorealistic',
        lighting: 'neon glow',
        details: 'wet asphalt reflections, crowd under umbrellas',
      },
    });
    expect(result.prompt).toBe(
      'Negative prompt: blurry, low quality, watermark, deformed, bad anatomy, extra limbs, ' +
        'extra fingers, text, signature, logo\n\n' +
        'a cyberpunk city street in the rain, photorealistic, neon glow, wet asphalt reflections, ' +
        'crowd under umbrellas, 8k uhd, high detail, sharp focus, physically based rendering\n' +
        'Steps: 28, Sampler: Euler a, CFG scale: 7, Seed: -1',
    );
  });

  it('generic-llm: пустые необязательные слоты обрабатываются, заголовки остаются', () => {
    const result = buildPrompt(genericLlm, {
      slots: {
        task: 'REST API for task management with JWT auth',
        language: 'python',
        framework: 'FastAPI',
        context: 'PostgreSQL via SQLAlchemy 2.0; Python 3.12',
      },
    });
    expect(result.core).toContain('Framework/runtime: FastAPI');
    expect(result.core).toContain('Context and constraints:\nPostgreSQL via SQLAlchemy 2.0');
    expect(result.core).toContain('Requirements:');
    expect(result.core).toContain('Additional guidance (Python)');
    expect(result.prompt.endsWith(result.core)).toBe(true);
  });

  it('article: дефолты слотов заполняются, пустые audience/keywords убирают строки-метки', () => {
    const result = buildPrompt(article, {
      slots: { topic: 'как выбрать ноутбук для разработки' },
    });
    expect(result.core).toContain(
      'Write a 1200-word article in русском on the topic: как выбрать ноутбук для разработки.',
    );
    expect(result.core).toContain('Tone of voice: professional');
    expect(result.core).not.toContain('Target audience:');
    expect(result.core).not.toContain('SEO keywords to weave in naturally:');
    expect(result.core).toContain('Style note: neutral professional tone');
    expect(result.core).toContain('Structure requirements:');
  });
});
