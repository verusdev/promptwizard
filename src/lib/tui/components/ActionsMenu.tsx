import React from 'react';
import { Box, Text, useInput } from 'ink';
import { copyToClipboard } from '../../clipboard.js';
import { writeOutputFile } from '../../output.js';

interface ActionsMenuProps {
  prompt: string;
  onBack: () => void;
  onExit: () => void;
}

export function ActionsMenu({ prompt, onBack, onExit }: ActionsMenuProps): React.ReactElement {
  const [index, setIndex] = React.useState(0);
  const [msg, setMsg] = React.useState<string | null>(null);
  const actions = ['Скопировать в буфер', 'Сохранить в файл (out/prompt.txt)', 'Назад', 'Выйти'];

  useInput(async (input, key) => {
    if (key.upArrow || input === 'k') {
      setIndex((i) => (i - 1 + actions.length) % actions.length);
    } else if (key.downArrow || input === 'j') {
      setIndex((i) => (i + 1) % actions.length);
    } else if (key.return) {
      if (index === 0) {
        const res = await copyToClipboard(prompt);
        setMsg(res.ok ? 'Скопировано' : `Ошибка копирования: ${res.message}`);
      } else if (index === 1) {
        try {
          await writeOutputFile('out/prompt.txt', `${prompt}\n`);
          setMsg('Сохранено в out/prompt.txt');
        } catch (e) {
          setMsg(e instanceof Error ? e.message : String(e));
        }
      } else if (index === 2) {
        onBack();
      } else if (index === 3) {
        onExit();
      }
    } else if (key.escape || input === 'b') {
      onBack();
    }
  });

  return (
    <Box flexDirection="column">
      <Text bold>Действия</Text>
      {actions.map((a, i) => (
        <Text key={a} color={i === index ? 'cyan' : 'white'}>
          {i === index ? '→ ' : '  '}
          {a}
        </Text>
      ))}
      {msg ? <Text color="green">{msg}</Text> : null}
    </Box>
  );
}
