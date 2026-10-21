import type { Template, PromptType } from '../schemas.js';
import type { PromptResult } from '../engine/builder.js';
import type { TemplateRegistry } from '../templates/registry.js';

export type WizardStep = 'type' | 'platform' | 'slots' | 'preview' | 'actions';

export interface WizardState {
  step: WizardStep;
  type?: PromptType;
  platform?: string;
  template?: Template;
  slots: Record<string, string>;
  useNegative: boolean;
  result?: PromptResult;
}

export interface TuiProps {
  registry: TemplateRegistry;
}
