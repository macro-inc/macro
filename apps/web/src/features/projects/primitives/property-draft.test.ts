import type { DateProperty } from '@property/types';
import { expect, it } from 'vitest';
import { withProjectPropertyValue } from './property-draft';

const due: DateProperty = {
  propertyId: 'due',
  propertyDefinitionId: 'due',
  displayName: 'Due Date',
  isMultiSelect: false,
  owner: { scope: 'system' },
  createdAt: new Date(0),
  updatedAt: new Date(0),
  valueType: 'DATE',
  value: null,
};

it('keeps whether a drafted date has its time of day, and drops it for a whole day', () => {
  const at = new Date(2026, 10, 26, 14);
  const timed = withProjectPropertyValue(due, {
    valueType: 'DATE',
    value: at,
    hasTime: true,
  });
  expect(timed).toMatchObject({ value: at, hasTime: true });

  const day = withProjectPropertyValue(timed, {
    valueType: 'DATE',
    value: new Date(2026, 10, 27),
  });
  expect(day).toMatchObject({ value: new Date(2026, 10, 27) });
  expect('hasTime' in day).toBe(false);
});
