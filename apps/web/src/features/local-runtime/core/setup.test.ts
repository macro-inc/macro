import { describe, expect, it } from 'vitest';
import {
  agentHandle,
  chooseModel,
  offeredAgents,
  type SetupState,
  stepStatus,
} from './setup';

const detected = (id: string) => ({
  id,
  name: id,
  note: null,
  needs_install: false,
});

describe('offeredAgents', () => {
  it('prefers Claude Code, then Codex, and hides herdr and custom agents', () => {
    const offered = offeredAgents([
      detected('opencode'),
      detected('herdr-claude'),
      detected('codex'),
      detected('custom'),
      detected('claude-code'),
    ]);
    expect(offered.map((agent) => agent.id)).toEqual([
      'claude-code',
      'codex',
      'opencode',
    ]);
  });
});

describe('chooseModel', () => {
  it('keeps the runtime’s current model when it is in the catalog', () => {
    expect(
      chooseModel({
        status: 'available',
        currentModel: 'b',
        models: [
          { id: 'a', name: 'A' },
          { id: 'b', name: 'B' },
        ],
      })
    ).toBe('b');
  });

  it('falls back to the first model, and to none for an empty catalog', () => {
    expect(
      chooseModel({ status: 'available', models: [{ id: 'a', name: 'A' }] })
    ).toBe('a');
    expect(chooseModel({ status: 'available', models: [] })).toBeUndefined();
  });

  it('uses the default model when the runtime has no model selection', () => {
    expect(chooseModel({ status: 'unsupported', models: [] })).toBe('default');
  });
});

describe('agentHandle', () => {
  it('slugs the agent name', () => {
    expect(agentHandle('Claude Code')).toBe('claude-code');
    expect(agentHandle('  OpenCode! ')).toBe('opencode');
  });
});

describe('stepStatus', () => {
  const statuses = (state: SetupState) =>
    (['detect', 'connect', 'agent'] as const).map((step) =>
      stepStatus(state, step)
    );

  it('marks earlier steps done and later ones pending', () => {
    expect(statuses({ kind: 'running', step: 'connect' })).toEqual([
      'done',
      'active',
      'pending',
    ]);
    expect(
      statuses({ kind: 'failed', step: 'agent', message: 'nope' })
    ).toEqual(['done', 'done', 'failed']);
    expect(statuses({ kind: 'no-agents' })).toEqual([
      'failed',
      'pending',
      'pending',
    ]);
  });
});
