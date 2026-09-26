import type { PropertyOption } from '@service-properties/generated/schemas/propertyOption';
import { describe, expect, it } from 'vitest';
import { usablePropertyOptions } from './options-data';

const cachedOption = {
  id: 'status-in-progress',
  property_definition_id: 'status',
  display_order: 1,
  created_at: '2025-01-01T00:00:00Z',
  updated_at: '2025-01-01T00:00:00Z',
  value: { type: 'string', value: 'In Progress' },
} satisfies PropertyOption;

describe('usablePropertyOptions', () => {
  it('retains cached options after an offline refresh failure', () => {
    const cached = [cachedOption];

    expect(usablePropertyOptions({ data: cached, isError: true })).toBe(cached);
  });

  it('uses a stable empty catalog before any successful load', () => {
    expect(usablePropertyOptions({ data: undefined, isError: true })).toEqual(
      []
    );
  });
});

it('uses already-loaded definition options while the option query is a placeholder', () => {
  const loaded = [cachedOption];
  expect(
    usablePropertyOptions(
      { data: [], isError: false, isPlaceholderData: true },
      loaded
    )
  ).toBe(loaded);
  expect(
    usablePropertyOptions(
      { data: [], isError: false, isPlaceholderData: false },
      loaded
    )
  ).toEqual([]);
});

it('does not mask an unsuccessful first option request with definition options', () => {
  expect(
    usablePropertyOptions(
      { data: undefined, isError: true, isPlaceholderData: false },
      [cachedOption]
    )
  ).toEqual([]);
});
