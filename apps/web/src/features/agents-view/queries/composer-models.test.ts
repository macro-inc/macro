import { createRoot, createSignal } from 'solid-js';
import { describe, expect, it, vi } from 'vitest';
import type { RosterAgent } from '../core/roster';
import { composerModelTarget, createComposerModels } from './composer-models';

const discovery = vi.hoisted(() => ({
  targets: undefined as (() => unknown) | undefined,
  queries: [] as object[],
}));

vi.mock('@queries/agents/models', () => ({
  useAgentModelsQueries: (targets: () => unknown) => {
    discovery.targets = targets;
    return discovery.queries;
  },
}));

describe('composer model discovery', () => {
  it('uses runtime identities rather than bot ids to discover models', () => {
    expect(composerModelTarget({ harness: 'macro-inmem' })).toEqual({
      harness: 'in-memory',
    });
    expect(composerModelTarget({ harness: 'cursor' })).toEqual({
      harness: 'cursor',
    });
    expect(
      composerModelTarget({ harness: 'macrod', harnessId: 'paired-runtime' })
    ).toEqual({ harness: 'macrod', harnessId: 'paired-runtime' });
    expect(composerModelTarget({ harness: 'macrod' })).toBeUndefined();
    expect(composerModelTarget({ harness: 'sandbox' })).toBeUndefined();
    expect(composerModelTarget({ harness: 'claude-cloud' })).toEqual({
      harness: 'claude-cloud',
    });
  });

  it('switches discovery targets with the selected agent and skips disconnected runtimes', () => {
    discovery.queries = [];
    createRoot((dispose) => {
      const [agent, setAgent] = createSignal<RosterAgent>({
        id: 'bot-one',
        name: 'One',
        handle: 'one',
        kind: 'coder',
        share: 'private',
        harness: 'cursor',
        runtime: { label: 'Cursor', connected: true },
      });
      createComposerModels(agent);
      expect(discovery.targets?.()).toEqual([{ harness: 'cursor' }]);
      setAgent({ ...agent(), harness: 'claude-cloud' });
      expect(discovery.targets?.()).toEqual([{ harness: 'claude-cloud' }]);
      setAgent({ ...agent(), harness: 'macrod', harnessId: 'paired-runtime' });
      expect(discovery.targets?.()).toEqual([
        { harness: 'macrod', harnessId: 'paired-runtime' },
      ]);
      setAgent({ ...agent(), runtime: { label: 'Offline', connected: false } });
      expect(discovery.targets?.()).toEqual([]);
      dispose();
    });
  });

  it('does not read pending resource data and exposes discovered choices when ready', () => {
    createRoot((dispose) => {
      const [ready, setReady] = createSignal(false);
      const models = [{ id: 'runtime-model', name: 'Runtime model' }];
      discovery.queries = [
        {
          get isSuccess() {
            return ready();
          },
          get isPending() {
            return !ready();
          },
          get data() {
            if (!ready()) throw new Error('Pending resource must not be read');
            return {
              models,
              currentModel: 'runtime-model',
              status: 'available',
            };
          },
        },
      ];
      const source = createComposerModels(() => ({
        id: 'bot',
        name: 'Agent',
        handle: 'agent',
        kind: 'coder',
        share: 'private',
        harness: 'cursor',
        runtime: { label: 'Cursor', connected: true },
      }));
      expect(source.models()).toEqual([]);
      expect(source.message()).toBe('Loading models…');
      setReady(true);
      expect(source.models()).toEqual(models);
      expect(source.currentModel()).toBe('runtime-model');
      dispose();
    });
  });
});
