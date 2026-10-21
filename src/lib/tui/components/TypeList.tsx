import React from 'react';
import { Box, Text, useInput } from 'ink';
import { PROMPT_TYPES } from '../../schemas.js';
import type { PromptType } from '../../schemas.js';

interface TypeListProps {
  selected?: PromptType;
  onSelect: (type: PromptType) => void;
  onBack?: () => void;
}

export function TypeList({ selected, onSelect, onBack }: TypeListProps): React.ReactElement {
  const [index, setIndex] = React.useState(() => {
    if (!selected) return 0;
    const i = PROMPT_TYPES.findIndex((t) => t === selected);
    return i >= 0 ? i : 0;
  });

  useInput((input, key) => {
    if (key.upArrow || input === 'k') {
      setIndex((i) => (i - 1 + PROMPT_TYPES.length) % PROMPT_TYPES.length);
    } else if (key.downArrow || input === 'j') {
      setIndex((i) => (i + 1) % PROMPT_TYPES.length);
    } else if (key.return) {
      onSelect(PROMPT_TYPES[index]!);
    } else if (key.escape || input === 'b') {
      if (onBack) onBack();
    }
  });

  return (
    <Box flexDirection="column">
      <Text bold>Тип промта</Text>
      {PROMPT_TYPES.map((t, i) => (
        <Text key={t} color={i === index ? 'cyan' : 'white'}>
          {i === index ? '→ ' : '  '}
          {t}
        </Text>
      ))}
    </Box>
  );
}
