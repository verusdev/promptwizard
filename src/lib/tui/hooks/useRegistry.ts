import { useState } from 'react';
import type { TemplateRegistry } from '../../templates/registry.js';

export function useRegistry(registry: TemplateRegistry) {
  const [ready] = useState(true);
  return { registry, ready };
}
