import React from 'react';
import { Box, Text, useApp, useInput } from 'ink';
import { buildPrompt } from '../engine/builder.js';
import { findTemplate, platformsForType } from '../templates/registry.js';
import { PROMPT_TYPES } from '../schemas.js';
import type { PromptType } from '../schemas.js';
import { Layout } from './components/Layout.js';
import { TypeList } from './components/TypeList.js';
import { PlatformList } from './components/PlatformList.js';
import { SlotForm } from './components/SlotForm.js';
import { PreviewPanel } from './components/PreviewPanel.js';
import { ActionsMenu } from './components/ActionsMenu.js';
import { ErrorView } from './components/ErrorView.js';
import type { TuiProps } from './types.js';

export function App({ registry }: TuiProps): React.ReactElement {
  const { exit } = useApp();
  const [step, setStep] = React.useState<'type' | 'platform' | 'slots' | 'actions'>('type');
  const [type, setType] = React.useState<PromptType | undefined>(undefined);
  const [platform, setPlatform] = React.useState<string | undefined>(undefined);
  const [slots, setSlots] = React.useState<Record<string, string>>({});
  const [useNegative, setUseNegative] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  // Ctrl+C — тихий выход без stack trace.
  useInput((input, key) => {
    if (key.ctrl && input === 'c') {
      exit();
    }
  });

  const template = React.useMemo(() => {
    if (type === undefined || platform === undefined) return undefined;
    try {
      return findTemplate(registry, type, platform);
    } catch {
      return undefined;
    }
  }, [registry, type, platform]);

  const handleType = (t: PromptType): void => {
    setType(t);
    setError(null);
    const platforms = platformsForType(registry, t);
    if (platforms.length === 1 && platforms[0]) {
      setPlatform(platforms[0].slug);
      setStep('slots');
    } else {
      setPlatform(undefined);
      setStep('platform');
    }
  };

  const handlePlatform = (p: string): void => {
    setPlatform(p);
    setError(null);
    setStep('slots');
  };

  const handleSlotsNext = (): void => {
    if (!template) return;
    try {
      const result = buildPrompt(template, { slots, flags: { negative: useNegative } });
      setUseNegative(result.negative !== undefined && result.negative !== '');
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
    setStep('actions');
  };

  const handleBack = (): void => {
    setError(null);
    if (step === 'actions') setStep('slots');
    else if (step === 'slots') {
      setSlots({});
      if (type !== undefined && platform !== undefined) {
        const platforms = platformsForType(registry, type);
        if (platforms.length === 1 && platforms[0]) setStep('slots');
        else setStep('platform');
      } else {
        setStep('type');
      }
    } else if (step === 'platform') setStep('type');
  };

  const handleExit = (): void => {
    exit();
  };

  const result = React.useMemo(() => {
    if (!template) return undefined;
    try {
      return buildPrompt(template, { slots, flags: { negative: useNegative } });
    } catch {
      return undefined;
    }
  }, [template, slots, useNegative]);

  let title = 'Выбор типа';
  let hint = '↑/↓ — выбор, Enter — подтвердить';
  let body: React.ReactNode;

  switch (step) {
    case 'type':
      body = <TypeList selected={type} onSelect={handleType} onBack={handleExit} />;
      break;
    case 'platform':
      body = (
        <PlatformList
          registry={registry}
          type={type ?? PROMPT_TYPES[0]!}
          onSelect={handlePlatform}
          onBack={handleBack}
        />
      );
      title = 'Выбор платформы';
      break;
    case 'slots':
      title = 'Слоты шаблона';
      hint = 'Tab/Enter — следующий слот, b/Esc — назад';
      body = template ? (
        <Box flexDirection="column">
          <SlotForm
            template={template}
            values={slots}
            onChange={setSlots}
            onNext={handleSlotsNext}
            onBack={handleBack}
          />
          <PreviewPanel template={template} slots={slots} useNegative={useNegative} />
        </Box>
      ) : (
        <ErrorView message="Шаблон не найден" />
      );
      break;
    case 'actions':
      title = 'Готово';
      body = result ? (
        <Box flexDirection="column">
          <Text bold>Собранный промт:</Text>
          <Text color="cyan">{result.prompt}</Text>
          <ActionsMenu prompt={result.prompt} onBack={handleBack} onExit={handleExit} />
        </Box>
      ) : (
        <ErrorView message={error ?? 'Не удалось собрать промт'} />
      );
      break;
    default:
      body = <ErrorView message="Неизвестный шаг" />;
  }

  return (
    <Layout title={title} hint={hint}>
      {error && step !== 'actions' ? <ErrorView message={error} /> : null}
      {body}
    </Layout>
  );
}
