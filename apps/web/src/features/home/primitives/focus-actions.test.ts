import { createRoot } from 'solid-js';
import { describe, expect, it } from 'vitest';
import { FOCUS_ACTIONS } from '../core/focus-actions';
import { createFocusActions } from './focus-actions';

describe('local Home actions', () => {
  it('keeps edited drafts through dismissal and undo without mutating fixtures', () =>
    createRoot((dispose) => {
      const state = createFocusActions(FOCUS_ACTIONS);
      const first = FOCUS_ACTIONS[0];
      const original = first.draft;
      state.updateDraft(first.id, 'Revised reply');
      state.dismiss(first.id);
      expect(state.actions()).toHaveLength(4);
      expect(state.selectedId()).toBe(FOCUS_ACTIONS[1].id);
      state.undo();
      expect(state.actions()).toHaveLength(5);
      expect(state.draft(first)).toBe('Revised reply');
      expect(first.draft).toBe(original);
      dispose();
    }));

  it('moves within the remaining items and can recover after clearing all of them', () =>
    createRoot((dispose) => {
      const state = createFocusActions(FOCUS_ACTIONS);
      state.move(-1);
      expect(state.selectedId()).toBe(FOCUS_ACTIONS[0].id);
      for (const action of FOCUS_ACTIONS) state.dismiss(action.id);
      expect(state.actions()).toHaveLength(0);
      expect(state.move(1)).toBeUndefined();
      state.undo();
      expect(state.actions()).toHaveLength(1);
      expect(state.selectedId()).toBe(FOCUS_ACTIONS.at(-1)?.id);
      dispose();
    }));
});
