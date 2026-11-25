import { describe, expect, it } from 'vitest';
import {
  DRIVE_CREATOR_PRESET_ME,
  DRIVE_CREATOR_PRESET_MY_AGENTS,
  DRIVE_CREATOR_PRESET_TEAM_AGENTS,
  isDriveCreatorPreset,
  isDriveModifiedPreset,
  matchesDateRange,
  modifiedPresetRange,
  resolveCreatorOptionIds,
} from './drive-filters';

describe('drive-filters', () => {
  it('resolves creator presets to concrete owner IDs', () => {
    const ctx = {
      userId: 'macro|alice@example.com',
      myAgentIds: ['macro|agent-1@example.com'],
      teamAgentIds: ['macro|agent-1@example.com', 'macro|agent-2@example.com'],
    };

    expect(resolveCreatorOptionIds(DRIVE_CREATOR_PRESET_ME, ctx)).toEqual([
      'macro|alice@example.com',
    ]);
    expect(
      resolveCreatorOptionIds(DRIVE_CREATOR_PRESET_MY_AGENTS, ctx)
    ).toEqual(['macro|agent-1@example.com']);
    expect(
      resolveCreatorOptionIds(DRIVE_CREATOR_PRESET_TEAM_AGENTS, ctx)
    ).toEqual(['macro|agent-1@example.com', 'macro|agent-2@example.com']);
    expect(resolveCreatorOptionIds('macro|bob@example.com', ctx)).toEqual([
      'macro|bob@example.com',
    ]);
    expect(
      resolveCreatorOptionIds(DRIVE_CREATOR_PRESET_MY_AGENTS, {
        userId: 'macro|alice@example.com',
        myAgentIds: [],
      })
    ).toEqual([]);
  });

  it('detects creator and modified preset IDs', () => {
    expect(isDriveCreatorPreset(DRIVE_CREATOR_PRESET_ME)).toBe(true);
    expect(isDriveCreatorPreset('macro|alice@example.com')).toBe(false);
    expect(isDriveModifiedPreset('last-7-days')).toBe(true);
    expect(isDriveModifiedPreset('bogus')).toBe(false);
  });

  it('builds stable date ranges and evaluates timestamps accurately', () => {
    const now = new Date('2026-06-15T14:30:00.000Z');
    const last7 = modifiedPresetRange('last-7-days', now);
    expect(last7.gte).toBeDefined();
    expect(last7.lt).toBeUndefined();

    expect(matchesDateRange('2026-06-14T10:00:00.000Z', last7)).toBe(true);
    expect(matchesDateRange('2026-06-01T10:00:00.000Z', last7)).toBe(false);

    const lastYear = modifiedPresetRange('last-year', now);
    expect(lastYear.gte).toBeDefined();
    expect(lastYear.lt).toBeDefined();
    expect(matchesDateRange('2025-07-01T00:00:00.000Z', lastYear)).toBe(true);
    expect(matchesDateRange('2026-02-01T00:00:00.000Z', lastYear)).toBe(false);
    expect(matchesDateRange('2024-12-31T00:00:00.000Z', lastYear)).toBe(false);
    expect(matchesDateRange(undefined, lastYear)).toBe(false);
  });
});
