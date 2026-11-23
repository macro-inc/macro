import { createRoot, createSignal } from 'solid-js';
import { describe, expect, it } from 'vitest';
import type { AgentActivityRow } from '../context/agent-activity-source';
import { createPanelState } from './create-panel-state';

const row = (id: string, entityId: string, verb: string): AgentActivityRow => ({
  id,
  entityType: 'document',
  entityId,
  action: verb,
  verb,
  occurredAt: new Date(Number(id) * 1000).toISOString(),
});

describe('createPanelState', () => {
  it('keeps each step intact across repeated live updates', () => {
    const { state, setRows, dispose } = createRoot((dispose) => {
      const [rows, setRows] = createSignal([row('1', 'a', 'created')]);
      const state = createPanelState({
        rows,
        isPending: () => false,
        hasMore: () => false,
        loadMore: () => {},
      });
      return { state, setRows, dispose };
    });
    for (const id of ['2', '3', '4']) {
      setRows((current) => [row(id, 'a', 'edited'), ...current]);
    }
    const steps = state
      .items()[0]
      ?.steps.map((step) => [step.verb, step.count, step.latest.id]);
    expect(steps).toEqual([
      ['edited', 3, '4'],
      ['created', 1, '1'],
    ]);
    expect(state.openKey()).toBe(state.items()[0]?.key);
    dispose();
  });
});
