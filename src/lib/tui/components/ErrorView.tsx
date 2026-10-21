import React from 'react';
import { Box, Text } from 'ink';

interface ErrorViewProps {
  message: string;
}

export function ErrorView({ message }: ErrorViewProps): React.ReactElement {
  return (
    <Box flexDirection="column">
      <Text color="red">Ошибка: {message}</Text>
    </Box>
  );
}
