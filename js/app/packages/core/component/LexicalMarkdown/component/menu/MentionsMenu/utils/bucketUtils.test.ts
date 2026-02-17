import { describe, it, expect } from 'vitest';
import { getViewAllLabel, shouldShowViewAllButton } from './bucketUtils';

describe('getViewAllLabel', () => {
  it('returns "View all (count)" when totalCount exceeds showingCount', () => {
    expect(getViewAllLabel(10, 3)).toBe('View all (10)');
  });

  it('returns "View all" when hasNextPage is true', () => {
    expect(getViewAllLabel(3, 3, true)).toBe('View all');
  });

  it('returns undefined when counts are equal and no next page', () => {
    expect(getViewAllLabel(5, 5, false)).toBeUndefined();
  });

  it('returns undefined when totalCount is undefined', () => {
    expect(getViewAllLabel(undefined, 5)).toBeUndefined();
  });

  it('returns undefined when showingCount is undefined', () => {
    expect(getViewAllLabel(10, undefined)).toBeUndefined();
  });

  it('prefers count label over generic when totalCount exceeds showingCount with hasNextPage', () => {
    expect(getViewAllLabel(10, 3, true)).toBe('View all (10)');
  });
});

describe('shouldShowViewAllButton', () => {
  it('returns true when totalCount exceeds showingCount', () => {
    expect(shouldShowViewAllButton(10, 3)).toBe(true);
  });

  it('returns true when hasNextPage is true', () => {
    expect(shouldShowViewAllButton(3, 3, true)).toBe(true);
  });

  it('returns false when counts are equal and no next page', () => {
    expect(shouldShowViewAllButton(5, 5, false)).toBe(false);
  });

  it('returns false when totalCount is undefined', () => {
    expect(shouldShowViewAllButton(undefined, 5)).toBe(false);
  });

  it('returns false when showingCount is undefined', () => {
    expect(shouldShowViewAllButton(10, undefined)).toBe(false);
  });

  it('returns false when both undefined and no next page', () => {
    expect(shouldShowViewAllButton(undefined, undefined, false)).toBe(false);
  });
});
