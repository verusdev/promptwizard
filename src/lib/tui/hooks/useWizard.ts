import { useState } from 'react';
import type { PromptType } from '../../schemas.js';
import type { Template } from '../../schemas.js';
import type { PromptResult } from '../../engine/builder.js';
import type { WizardStep } from '../types.js';

export interface WizardState {
  step: WizardStep;
  type?: PromptType;
  platform?: string;
  template?: Template;
  slots: Record<string, string>;
  useNegative: boolean;
  result?: PromptResult;
}

export function useWizard() {
  const [state, setState] = useState<WizardState>({
    step: 'type',
    slots: {},
    useNegative: false,
  });

  return { state, setState };
}
