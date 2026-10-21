import React from 'react';
import { Box, Text } from 'ink';
import type { TuiProps } from './types.js';

export function App({ registry }: TuiProps): React.ReactElement {
  void registry;
  return (
    <Box flexDirection="column">
      <Text color="cyan">PromptWizard TUI</Text>
      <Text>Базовый каркас (MT03–MT04). Полная реализация — следующий этап.</Text>
    </Box>
  );
}
