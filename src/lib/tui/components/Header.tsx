import React from 'react';
import { Box, Text } from 'ink';
import { theme } from '../theme.js';

interface HeaderProps {
  title: string;
}

export function Header({ title }: HeaderProps): React.ReactElement {
  return (
    <Box>
      <Text bold color={theme.accent}>
        PromptWizard
      </Text>
      <Text color={theme.muted}> — </Text>
      <Text>{title}</Text>
    </Box>
  );
}
