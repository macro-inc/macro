import { describe, expect, it } from 'vitest';
import { computeVisiblePillValues } from './pillTabsLayout';

const values = ['A', 'B', 'C', 'D', 'E', 'F'] as const;
const widths = [20, 20, 20, 20, 20, 20];

describe('computeVisiblePillValues', () => {
  it('returns all values when they fit without overflow', () => {
    expect(
      computeVisiblePillValues({
        values,
        activeValue: 'A',
        currentVisibleValues: [],
        widths,
        availableWidth: 200,
        gap: 5,
        overflowWidth: 10,
      })
    ).toEqual(['A', 'B', 'C', 'D', 'E', 'F']);
  });

  it('places an overflow-selected value as the last visible pill', () => {
    expect(
      computeVisiblePillValues({
        values,
        activeValue: 'D',
        currentVisibleValues: ['A', 'B', 'C'],
        widths,
        availableWidth: 85,
        gap: 5,
        overflowWidth: 10,
      })
    ).toEqual(['A', 'B', 'D']);
  });

  it('preserves the visible row when selecting an already-visible value', () => {
    expect(
      computeVisiblePillValues({
        values,
        activeValue: 'A',
        currentVisibleValues: ['A', 'B', 'D'],
        widths,
        availableWidth: 85,
        gap: 5,
        overflowWidth: 10,
      })
    ).toEqual(['A', 'B', 'D']);
  });

  it('fills newly available room without replacing visible pills', () => {
    expect(
      computeVisiblePillValues({
        values,
        activeValue: 'A',
        currentVisibleValues: ['A', 'D'],
        widths,
        availableWidth: 85,
        gap: 5,
        overflowWidth: 10,
      })
    ).toEqual(['A', 'D', 'B']);
  });
});
