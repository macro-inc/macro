import { createRoot, createSignal } from 'solid-js';
import { describe, expect, it, vi } from 'vitest';
import { createCrmFilterSelections } from './filter-selections';

describe('CRM filter selection semantics', () => {
  it('does not read pending stage metadata while constructing filter state', () => {
    const defaultStages = vi.fn(() => ['active']);
    const { state, dispose } = createRoot((dispose) => {
      const [stageFilter, setStageFilter] = createSignal<string[]>([]);
      const [ownerFilter, setOwnerFilter] = createSignal<string[]>([]);
      return {
        dispose,
        state: createCrmFilterSelections({
          stageFilter,
          setStageFilter,
          ownerFilter,
          setOwnerFilter,
          defaultStages,
          isActive: () => false,
          toggle: () => {},
        }),
      };
    });
    expect(defaultStages).not.toHaveBeenCalled();
    expect(state.effectiveStages()).toEqual(['active']);
    expect(defaultStages).toHaveBeenCalledOnce();
    dispose();
  });
  it('treats the active default set as no filter and keeps legacy stages opt-in', () => {
    const { state, selected, active, dispose } = createRoot((dispose) => {
      const [stageFilter, setStageFilter] = createSignal<string[]>([]);
      const [ownerFilter, setOwnerFilter] = createSignal<string[]>([]);
      const active = new Set<string>();
      return {
        dispose,
        selected: stageFilter,
        active,
        state: createCrmFilterSelections({
          stageFilter,
          setStageFilter,
          ownerFilter,
          setOwnerFilter,
          defaultStages: () => ['active', 'NO_STAGE'],
          isActive: (id) => active.has(id),
          toggle: (id) => {
            if (active.has(id)) active.delete(id);
            else active.add(id);
          },
        }),
      };
    });
    expect(state.effectiveStages()).toEqual(['active', 'NO_STAGE']);
    state.changeStage(['active', 'legacy', 'NO_STAGE']);
    expect(selected()).toEqual(['active', 'legacy', 'NO_STAGE']);
    expect(active.has('company-stage')).toBe(true);
    state.changeStage(['NO_STAGE', 'active']);
    expect(selected()).toEqual([]);
    expect(active.has('company-stage')).toBe(false);
    state.changeStageChip(['active', 'NO_STAGE']);
    expect(selected()).toEqual(['active', 'NO_STAGE']);
    state.changeOwner(['teammate']);
    expect(active.has('company-owner')).toBe(true);
    state.changeOwner([]);
    expect(active.has('company-owner')).toBe(false);
    dispose();
  });
});
