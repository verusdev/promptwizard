import React from 'react';
import { Box, Text, useInput } from 'ink';
import type { Template } from '../../schemas.js';
import { validateTextSlot } from '../../validation/slots.js';

interface SlotFormProps {
  template: Template;
  values: Record<string, string>;
  onChange: (values: Record<string, string>) => void;
  onNext: () => void;
  onBack: () => void;
}

export function SlotForm({
  template,
  values,
  onChange,
  onNext,
  onBack,
}: SlotFormProps): React.ReactElement {
  const slots = template.slots;
  const [index, setIndex] = React.useState(0);
  const [current, setCurrent] = React.useState('');
  const [error, setError] = React.useState<string | null>(null);

  const slot = slots[index];

  useInput((input, key) => {
    if (key.escape || (input === 'b' && !key.shift)) {
      onBack();
      return;
    }
    if (key.tab || key.return) {
      if (!slot) return;
      const activeSlot: Template['slots'][number] = slot;
      if (activeSlot.type === 'enum' && activeSlot.options) {
        const opts = activeSlot.options;
        const cur = values[activeSlot.key] ?? activeSlot.default ?? opts[0] ?? '';
        const idx = Math.max(0, opts.indexOf(cur));
        const next = opts[(idx + 1) % opts.length]!;
        onChange({ ...values, [activeSlot.key]: next });
        setError(null);
        if (index < slots.length - 1) setIndex(index + 1);
        else onNext();
        return;
      }
      const result = validateTextSlot(activeSlot, current);
      if (result !== true) {
        setError(result);
        return;
      }
      const nextVals = { ...values };
      if (current.trim() !== '') nextVals[activeSlot.key] = current.trim();
      onChange(nextVals);
      setCurrent('');
      setError(null);
      if (index < slots.length - 1) setIndex(index + 1);
      else onNext();
      return;
    }
    if (key.backspace || key.delete) {
      setCurrent((c) => c.slice(0, -1));
      return;
    }
    if (
      input &&
      !key.ctrl &&
      !key.meta &&
      !key.upArrow &&
      !key.downArrow &&
      !key.leftArrow &&
      !key.rightArrow
    ) {
      setCurrent((c) => c + input);
    }
  });

  if (!slot) {
    return <Text>Слоты закончены — Enter/Tab для продолжения</Text>;
  }

  return (
    <Box flexDirection="column">
      <Text bold>Заполнение слотов</Text>
      <Text color="gray">
        [{index + 1}/{slots.length}]
      </Text>
      <Text>
        {slot.label}
        {slot.required ? ' *' : ''}
      </Text>
      {slot.description ? <Text color="gray">{slot.description}</Text> : null}
      {slot.type === 'enum' && slot.options ? (
        <Text>
          Значение: {values[slot.key] ?? slot.default ?? slot.options[0]} (Tab/Enter — следующий
          вариант)
        </Text>
      ) : (
        <Text>
          {'> '}
          {current || (values[slot.key] ? `[${values[slot.key]}]` : '...')}
        </Text>
      )}
      {error ? <Text color="red">{error}</Text> : null}
      <Text color="gray">Tab/Enter — следующий | b/Esc — назад</Text>
    </Box>
  );
}
