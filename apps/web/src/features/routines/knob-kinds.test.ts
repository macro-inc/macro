import { RoutineKnobEntityType } from '@service-scheduled-action/generated/schemas';
import { describe, expect, it, vi } from 'vitest';

// The selector's helpers import Quick Access, whose module pulls in the
// editor; only its bucket table matters here.
vi.mock('@core/context/quickAccess', () => ({
  useQuickAccess: () => ({}),
}));

import { PICKABLE_ENTITY_TYPES } from '@property/editors/selectors/entityUtils';
import { knobPickerType, knobTypeOfPicked } from './core/knobs';

describe('the kinds an entity knob can name', () => {
  it('are what the entity selector can pick, plus a whole database', () => {
    const picked = Object.values(RoutineKnobEntityType)
      .filter((type) => type !== 'database')
      .map(knobPickerType);
    expect(picked.toSorted()).toEqual(PICKABLE_ENTITY_TYPES.toSorted());
    // The selector can't pick a whole database; the knob lists them itself.
    expect(knobPickerType('database')).toBeUndefined();
  });

  it('take back each kind the selector picks', () => {
    for (const type of PICKABLE_ENTITY_TYPES) {
      const kind = knobTypeOfPicked(type);
      expect(kind && knobPickerType(kind)).toBe(type);
    }
    expect(knobTypeOfPicked('DATABASE_ROW')).toBeUndefined();
  });
});
