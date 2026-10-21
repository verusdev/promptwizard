import React from 'react';
import { Box, Text, useInput } from 'ink';
import { platformsForType } from '../../templates/registry.js';
import type { TemplateRegistry } from '../../templates/registry.js';
import type { PromptType } from '../../schemas.js';

interface PlatformListProps {
  registry: TemplateRegistry;
  type: PromptType;
  onSelect: (platform: string) => void;
  onBack: () => void;
}

export function PlatformList({
  registry,
  type,
  onSelect,
  onBack,
}: PlatformListProps): React.ReactElement {
  const platforms = platformsForType(registry, type);
  const [index, setIndex] = React.useState(0);

  useInput((input, key) => {
    if (key.upArrow || input === 'k') {
      setIndex((i) => (i - 1 + platforms.length) % platforms.length);
    } else if (key.downArrow || input === 'j') {
      setIndex((i) => (i + 1) % platforms.length);
    } else if (key.return && platforms[index]) {
      onSelect(platforms[index].slug);
    } else if (key.escape || input === 'b') {
      onBack();
    }
  });

  if (platforms.length === 0) {
    return <Text color="red">Для этого типа нет доступных платформ</Text>;
  }

  return (
    <Box flexDirection="column">
      <Text bold>Платформа</Text>
      {platforms.map((p, i) => (
        <Text key={p.slug} color={i === index ? 'cyan' : 'white'}>
          {i === index ? '→ ' : '  '}
          {p.platform}
        </Text>
      ))}
    </Box>
  );
}
