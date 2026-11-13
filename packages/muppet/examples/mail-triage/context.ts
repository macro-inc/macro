import { mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { behavior, type ContextOf } from '../../core/behavior.ts';
import type { Files, StatePaths } from '../../core/state.ts';

export type Model = { readonly decide: (question: string) => Promise<boolean> };

// This agent's state layout. A fresh directory per run unless MUPPET_STATE is set.
const root =
  process.env.MUPPET_STATE ?? (await mkdtemp(join(tmpdir(), 'muppet-')));
const sharedDirectory = 'shared';
const capabilitiesDirectory = 'capabilities';

const state: StatePaths = {
  shared: join(root, sharedDirectory),
  capability: (name) => join(root, capabilitiesDirectory, name),
};

const files: Files = {
  read: (path) => readFile(path, 'utf8').catch(() => undefined),
  write: async (path, text) => {
    await mkdir(dirname(path), { recursive: true });
    await writeFile(path, text);
  },
};

// A stand-in for a real model.
const model: Model = { decide: async (question) => question.includes('down') };

export const context = behavior().decorate({ state, files, model });

export type Context = ContextOf<typeof context>;
