import type { RosterAgent } from '@app/features/agents-view/core/roster';
import { createRoot, createSignal } from 'solid-js';
import { describe, expect, it, vi } from 'vitest';
import type {
  PromptBlockContext,
  PromptRun,
} from '../context/prompt-block-context';
import { createPromptRunner } from './prompt-runner';

const MACRO: RosterAgent = {
  id: 'macro',
  kind: 'agent',
  name: 'Macro',
  handle: 'macro',
  harness: 'in-memory',
  share: 'system',
  runtime: { label: 'Macro', connected: true },
};

const RESEARCHER: RosterAgent = {
  id: 'bot-researcher',
  botId: 'bot-researcher',
  kind: 'agent',
  name: 'Researcher',
  handle: 'researcher',
  harness: 'in-memory',
  share: 'team',
  runtime: { label: 'Macro', connected: true },
};

const CURSOR: RosterAgent = {
  id: 'bot-cursor',
  botId: 'bot-cursor',
  kind: 'coder',
  name: 'Cursor',
  handle: 'cursor',
  harness: 'cursor',
  share: 'system',
  runtime: { label: 'Cursor', connected: true },
};

const LAPTOP: RosterAgent = {
  id: 'bot-laptop',
  botId: 'bot-laptop',
  kind: 'coder',
  name: 'Laptop',
  handle: 'laptop',
  harness: 'macrod',
  share: 'private',
  runtime: { label: 'Laptop', connected: true },
};

function setup(overrides: Partial<PromptBlockContext> = {}) {
  const started: PromptRun[] = [];
  const chooseMode = vi.fn(async () => 'chat' as const);
  const context: PromptBlockContext = {
    accountId: () => 'macro|viewer@example.com',
    roster: () => [MACRO, RESEARCHER, CURSOR, LAPTOP],
    recentAgentIds: () => [],
    autoAvailable: () => true,
    chooseMode,
    start: (run) => started.push(run),
    ...overrides,
  };
  return createRoot((dispose) => ({
    runner: createPromptRunner(context),
    started,
    chooseMode,
    dispose,
  }));
}

describe('createPromptRunner', () => {
  it('starts on Auto and sends a chat prompt to Macro', async () => {
    const { runner, started, chooseMode } = setup();

    expect(runner.choice()).toBe('auto');
    expect(await runner.run('  Summarize my week  ')).toBe('started');

    expect(chooseMode).toHaveBeenCalledWith('Summarize my week');
    expect(started).toEqual([
      { prompt: 'Summarize my week', botId: undefined },
    ]);
  });

  it('sends a coding prompt on Auto to the most recently used coder', async () => {
    const { runner, started } = setup({
      recentAgentIds: () => ['bot-researcher', 'bot-laptop', 'bot-cursor'],
      chooseMode: async () => 'code',
    });

    await runner.run('Fix the flaky test');

    expect(started).toEqual([
      { prompt: 'Fix the flaky test', botId: 'bot-laptop' },
    ]);
  });

  it('skips the mode choice on Auto when no coder can start', async () => {
    const { runner, started, chooseMode } = setup({
      roster: () => [MACRO, { ...CURSOR, unavailableReason: 'Connect' }],
    });

    await runner.run('Fix the flaky test');

    expect(chooseMode).not.toHaveBeenCalled();
    expect(started).toEqual([
      { prompt: 'Fix the flaky test', botId: undefined },
    ]);
  });

  it('starts on Macro where Auto is off', async () => {
    const { runner, started, chooseMode } = setup({
      autoAvailable: () => false,
    });

    expect(runner.choice()).toBe('macro');
    await runner.run('Draft a reply');

    expect(chooseMode).not.toHaveBeenCalled();
    expect(started).toEqual([{ prompt: 'Draft a reply', botId: undefined }]);
  });

  it('runs with the chosen agent', async () => {
    const { runner, started, chooseMode } = setup();

    runner.choose('bot-researcher');
    await runner.run('Find recent papers');

    expect(chooseMode).not.toHaveBeenCalled();
    expect(started).toEqual([
      { prompt: 'Find recent papers', botId: 'bot-researcher' },
    ]);
  });

  it('offers only agents that can start, chat agents first', () => {
    const { runner } = setup({
      roster: () => [
        CURSOR,
        MACRO,
        { ...LAPTOP, unavailableReason: 'Its machine is disconnected' },
        RESEARCHER,
      ],
    });

    expect(runner.agents().map((agent) => agent.id)).toEqual([
      'macro',
      'bot-researcher',
      'bot-cursor',
    ]);
  });

  it('starts nothing when the chosen agent can no longer start', async () => {
    const [roster, setRoster] = createSignal([MACRO, RESEARCHER]);
    const { runner, started } = setup({ roster });

    runner.choose('bot-researcher');
    setRoster([MACRO, { ...RESEARCHER, unavailableReason: 'Offline' }]);

    expect(await runner.run('Find recent papers')).toBe('unavailable');
    expect(started).toEqual([]);
  });

  it('starts nothing for an empty prompt', async () => {
    const { runner, started } = setup();

    expect(await runner.run(' \n ')).toBe('empty');
    expect(started).toEqual([]);
  });

  it('starts nothing when the account changes while Auto is choosing', async () => {
    const [accountId, setAccountId] = createSignal('macro|viewer@example.com');
    let answer!: (mode: 'chat' | 'code') => void;
    const { runner, started } = setup({
      accountId,
      chooseMode: () =>
        new Promise((resolve) => {
          answer = resolve;
        }),
    });

    const run = runner.run('Fix the flaky test');
    expect(runner.running()).toBe(true);
    expect(await runner.run('Fix the flaky test')).toBe('busy');
    setAccountId('macro|other@example.com');
    answer('code');

    expect(await run).toBe('unavailable');
    expect(started).toEqual([]);
    expect(runner.running()).toBe(false);
  });
});
