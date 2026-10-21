import React from 'react';
import { Box, Text } from 'ink';
import { theme } from '../theme.js';

interface StatusBarProps {
  hint: string;
}

export function StatusBar({ hint }: StatusBarProps): React.ReactElement {
  return (
    <Box>
      <Text color={theme.muted}>{hint} | Ctrl+C: выход</Text>
    </Box>
  );
}
