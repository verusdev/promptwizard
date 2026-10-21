import { describe, expect, it } from 'vitest';
import {
  canonicalParamKey,
  collectRuleActions,
  conditionMatches,
  normalizeParamKey,
  renderInlineParams,
  renderSdParams,
  type RuleContext,
} from '../../src/lib/engine/rules.js';
import { makeTemplate } from '../helpers/fixtures.js';

function ctx(slots: Record<string, string> = {}, flags: Record<string, boolean> = {}): RuleContext {
  return { slots, flags };
}

describe('conditionMatches — оценка условий правил', () => {
  it('отсутствующий when означает «всегда»', () => {
    expect(conditionMatches(undefined, ctx())).toBe(true);
  });

  describe('флаги (when.flag)', () => {
    it('флаг включён → условие истинно', () => {
      expect(conditionMatches({ flag: 'negative' }, ctx({}, { negative: true }))).toBe(true);
    });

    it('флаг выключен → условие ложно', () => {
      expect(conditionMatches({ flag: 'negative' }, ctx({}, { negative: false }))).toBe(false);
    });

    it('неизвестный флаг → условие ложно', () => {
      expect(conditionMatches({ flag: 'unknown' }, ctx({}, { negative: true }))).toBe(false);
    });
  });

  describe('слоты (when.slot)', () => {
    it('слот только заполнен → истинно', () => {
      expect(conditionMatches({ slot: 'style' }, ctx({ style: 'anime' }))).toBe(true);
    });

    it('слот не заполнен → ложно', () => {
      expect(conditionMatches({ slot: 'style' }, ctx())).toBe(false);
    });

    it('equals: совпадение → истинно, несовпадение → ложно', () => {
      expect(conditionMatches({ slot: 'style', equals: 'anime' }, ctx({ style: 'anime' }))).toBe(
        true,
      );
      expect(conditionMatches({ slot: 'style', equals: 'anime' }, ctx({ style: 'noir' }))).toBe(
        false,
      );
    });

    it('notEquals: несовпадение → истинно, совпадение → ложно', () => {
      expect(conditionMatches({ slot: 'style', notEquals: 'anime' }, ctx({ style: 'noir' }))).toBe(
        true,
      );
      expect(conditionMatches({ slot: 'style', notEquals: 'anime' }, ctx({ style: 'anime' }))).toBe(
        false,
      );
    });

    it('in: значение из списка → истинно, иначе → ложно', () => {
      expect(conditionMatches({ slot: 'lang', in: ['go', 'rust'] }, ctx({ lang: 'go' }))).toBe(
        true,
      );
      expect(conditionMatches({ slot: 'lang', in: ['go', 'rust'] }, ctx({ lang: 'c' }))).toBe(
        false,
      );
    });

    it('несколько операторов в одном условии — все должны пройти (AND)', () => {
      const when = { slot: 'style', equals: 'anime', notEquals: 'pixel' } as const;
      expect(conditionMatches(when, ctx({ style: 'anime' }))).toBe(true);
      expect(conditionMatches(when, ctx({ style: 'pixel' }))).toBe(false);
      expect(conditionMatches(when, ctx({ style: 'noir' }))).toBe(false);
    });

    it('флаг и слот в одном условии — оба должны пройти (AND)', () => {
      const when = { flag: 'negative', slot: 'style', equals: 'anime' } as const;
      expect(conditionMatches(when, ctx({ style: 'anime' }, { negative: true }))).toBe(true);
      expect(conditionMatches(when, ctx({ style: 'anime' }, { negative: false }))).toBe(false);
      expect(conditionMatches(when, ctx({ style: 'noir' }, { negative: true }))).toBe(false);
    });
  });
});

describe('collectRuleActions — сбор действий сработавших правил', () => {
  it('собирает все типы действий в порядке правил шаблона', () => {
    const template = makeTemplate({
      slots: [{ key: 'style', label: 'Стиль', type: 'enum', options: ['a', 'b'] }],
      template: '{style}',
      rules: [
        {
          when: { slot: 'style', equals: 'a' },
          append: ', append-a',
          prepend: 'pre-a ',
          replace: { find: 'a', with: 'A' },
          negative: 'neg-a',
          setParam: { '--ar': '16:9', chaos: '0' },
          removeParam: ['v'],
        },
        { when: { slot: 'style', equals: 'z' }, append: ', never' },
        { when: { flag: 'negative' }, negative: 'neg-flag' },
      ],
    });

    const actions = collectRuleActions(template, ctx({ style: 'a' }, { negative: true }));

    expect(actions.appends).toEqual([', append-a']);
    expect(actions.prepends).toEqual(['pre-a ']);
    expect(actions.replaces).toEqual([{ find: 'a', with: 'A' }]);
    expect(actions.negatives).toEqual(['neg-a', 'neg-flag']);
    expect(actions.params).toEqual([
      { key: '--ar', value: '16:9' },
      { key: '--chaos', value: '0' },
    ]);
    expect(actions.removals).toEqual(['--v']);
  });

  it('правило без when применяется всегда', () => {
    const template = makeTemplate({
      rules: [{ append: ' always' }, { prepend: 'start ' }],
    });
    const actions = collectRuleActions(template, ctx());
    expect(actions.appends).toEqual([' always']);
    expect(actions.prepends).toEqual(['start ']);
  });

  it('несработавшие правила не добавляют действий', () => {
    const template = makeTemplate({
      slots: [{ key: 'style', label: 'Стиль', type: 'enum', options: ['a'] }],
      template: '{style}',
      rules: [{ when: { slot: 'style', equals: 'b' }, append: ', nope' }],
    });
    const actions = collectRuleActions(template, ctx({ style: 'a' }));
    expect(actions.appends).toEqual([]);
  });
});

describe('канонизация ключей параметров', () => {
  it('canonicalParamKey добавляет "--", если дефиса нет', () => {
    expect(canonicalParamKey('ar')).toBe('--ar');
    expect(canonicalParamKey('--ar')).toBe('--ar');
    expect(canonicalParamKey(' --v ')).toBe('--v');
    // Уже «с дефисом» ключи не трогаются.
    expect(canonicalParamKey('-style')).toBe('-style');
  });

  it('normalizeParamKey приводит к "--key" в нижнем регистре', () => {
    expect(normalizeParamKey('AR')).toBe('--ar');
    expect(normalizeParamKey('--Ar')).toBe('--ar');
    expect(normalizeParamKey('  --AR  ')).toBe('--ar');
  });
});

describe('renderInlineParams — строковый рендер параметров', () => {
  it('рендерит "ключ значение" в порядке Map, пропуская пустые значения', () => {
    const params = new Map([
      ['--ar', '16:9'],
      ['--v', '  '],
      ['--stylize', '100'],
    ]);
    expect(renderInlineParams(params)).toBe('--ar 16:9 --stylize 100');
  });

  it('пустой набор → пустая строка', () => {
    expect(renderInlineParams(new Map())).toBe('');
  });
});

describe('renderSdParams — блочный рендер в духе Stable Diffusion', () => {
  it('рендерит известные параметры в фиксированном порядке, чужие игнорирует', () => {
    const params = new Map([
      ['--seed', '-1'],
      ['--STEPS', '28'],
      ['--ar', '16:9'],
      ['--sampler', 'Euler a'],
      ['--cfg', '7'],
      ['--model', 'sd-xl'],
      ['--unknown', 'x'],
    ]);
    expect(renderSdParams(params)).toBe(
      'Steps: 28, Sampler: Euler a, CFG scale: 7, Seed: -1, Model: sd-xl',
    );
  });

  it('параметры с пустым значением не попадают в строку', () => {
    const params = new Map([
      ['--steps', ' '],
      ['--seed', '42'],
    ]);
    expect(renderSdParams(params)).toBe('Seed: 42');
  });

  it('пустой набор → пустая строка', () => {
    expect(renderSdParams(new Map())).toBe('');
  });
});
