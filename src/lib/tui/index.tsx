import React from 'react';
import { render } from 'ink';
import type { TemplateRegistry } from '../templates/registry.js';
import { App } from './app.js';

export async function runTui(registry: TemplateRegistry): Promise<void> {
  const { waitUntilExit } = render(<App registry={registry} />, { exitOnCtrlC: false });
  await waitUntilExit();
}
