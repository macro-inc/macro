import { cleanup, render, screen } from '@solidjs/testing-library';
import { afterEach, expect, it } from 'vitest';
import type { DateProperty } from '../../types';
import { PropertyTooltip } from './PropertyTooltip';

afterEach(cleanup);

const due = (value: Date | null): DateProperty => ({
  propertyId: 'due',
  propertyDefinitionId: '00000001-0000-0000-0000-000000000004',
  displayName: 'Due Date',
  isMultiSelect: false,
  owner: { scope: 'system' },
  createdAt: new Date(0),
  updatedAt: new Date(0),
  valueType: 'DATE',
  value,
});

it('reads the range a dates pill shows, not the due date alone', () => {
  render(() => (
    <PropertyTooltip
      property={due(new Date(2026, 10, 24))}
      valueText="Nov 23 → Nov 24"
    />
  ));
  expect(screen.getByText('Nov 23 → Nov 24')).toBeTruthy();
  expect(screen.queryByText(/Nov 24, 2026/)).toBeNull();
});

it('reads a start-only pill rather than saying no due date is set', () => {
  render(() => <PropertyTooltip property={due(null)} valueText="Nov 23 →" />);
  expect(screen.getByText('Nov 23 →')).toBeTruthy();
  expect(screen.queryByText('No Due Date set')).toBeNull();
});

it('keeps the due date and the empty state without pill text', () => {
  render(() => <PropertyTooltip property={due(null)} />);
  expect(screen.getByText('No Due Date set')).toBeTruthy();
});
