import React from 'react';
import { Box, Text } from 'ink';
import { buildPrompt } from '../../engine/builder.js';
import type { Template } from '../../schemas.js';

interface PreviewPanelProps {
  template: Template;
  slots: Record<string, string>;
  useNegative: boolean;
}

export function PreviewPanel({
  template,
  slots,
  useNegative,
}: PreviewPanelProps): React.ReactElement {
  try {
    const result = buildPrompt(template, { slots, flags: { negative: useNegative } });
    const preview =
      result.prompt.length > 200 ? result.prompt.slice(0, 197) + '...' : result.prompt;
    return (
      <Box flexDirection="column">
        <Text bold>Превью</Text>
        <Text color="cyan">{preview}</Text>
      </Box>
    );
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return (
      <Box flexDirection="column">
        <Text bold>Превью</Text>
        <Text color="red">{msg}</Text>
      </Box>
    );
  }
}
