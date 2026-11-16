import type { Loaded } from '../../core/code.ts';
import { type Scripts, scriptStart } from '../pieces.ts';

const script = { file: '/agent/script.ts', name: 'Script' };

/** Code mode for a test that never looks at a module's code: every script loads as `module`. */
export const scripts = (module: unknown = {}): Scripts => ({
  load: async (): Promise<Loaded> => ({ kind: 'loaded', module }),
  signatures: async (_, names) => names.join('\n'),
  script,
});

/** The part of the system prompt that says how these scripts start. */
export const scriptsPrompt = `## Your scripts\n\nA script starts like this, so that \`context\` is typed:\n\n${scriptStart(script)}`;
