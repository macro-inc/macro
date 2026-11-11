/**
 * The agent's entrypoint: builds its real context and its behavior. `cli.ts` runs
 * it, or calls one of its capabilities from outside the running process.
 */
import { rm } from 'node:fs/promises';
import { query } from '@anthropic-ai/claude-agent-sdk';
import type { Scripts } from '@macro-inc/muppet/runtimes/pieces';
import { checker, loader } from '@macro-inc/muppet/utilities/scripts';
import typescript from 'typescript';
import { agentClaude } from './behavior/agent/claude.ts';
import { guards } from './behavior/agent/guards/index.ts';
import { profile } from './behavior/agent/profile.ts';
import { base as makeBase } from './behavior/context/index.ts';
import { assistant as makeAgent } from './behavior/index.ts';

const wakesLog = 'wakes';

export const base = makeBase({ root: import.meta.dir });

// One type checker for the life of the process: the first script pays for
// reading the agent's code, and each one after costs only its own check.
const check = checker({ typescript, config: base.config.tsconfig });

// Each script the agent runs is type-checked against its own code first, and only
// one that passes is written: to its repository, so it can import its
// packages, under a fresh name, so the module cache never hands back an old
// one, and only for as long as it takes to import it.
export const scripts: Scripts = {
  script: { file: base.config.scriptType, name: 'Script' },
  load: loader({
    directory: base.config.scripts,
    script: { file: base.config.scriptType, name: 'Script' },
    check: async (files) => check.check(files),
    id: () => crypto.randomUUID(),
    write: async (path, text) => {
      await Bun.write(path, text);
    },
    remove: (path) => rm(path, { force: true }),
    load: (path) => import(path),
  }),
  signatures: async (file, names) => check.signatures(file, names),
};

export const agent = agentClaude({
  query,
  model: base.config.model,
  profile: profile(base.config),
  environment: async () => ({ ...process.env, ...(await base.environment()) }),
  after: (milliseconds, run) => {
    const timer = setTimeout(run, milliseconds);
    return () => clearTimeout(timer);
  },
  guards,
  record: (entry) => base.log.event(wakesLog, entry),
});

export const assistant = makeAgent(base, agent);
