import { describe, expect, it } from 'vitest';
import {
  type DriveShareProvenance,
  driveShareProvenanceKey,
  driveShareScopeFromFacet,
  isDirectShareProvenance,
  matchesDriveShareScope,
  partitionSharedByProvenance,
} from './drive-share-provenance';

describe('drive-share-provenance', () => {
  const makeProv = (
    id: string,
    kind: DriveShareProvenance['kind'],
    extra: Partial<DriveShareProvenance> = {}
  ): DriveShareProvenance => ({
    entityType: 'document',
    entityId: id,
    kind,
    ...extra,
  });

  it('normalizes facet values to a share scope', () => {
    expect(driveShareScopeFromFacet(undefined)).toBe('all');
    expect(driveShareScopeFromFacet([])).toBe('all');
    expect(driveShareScopeFromFacet(['direct'])).toBe('direct');
    expect(driveShareScopeFromFacet(['team_or_channel'])).toBe(
      'team_or_channel'
    );
    expect(driveShareScopeFromFacet(['unknown'])).toBe('all');
  });

  it('builds case-insensitive provenance lookup keys', () => {
    expect(driveShareProvenanceKey('DOCUMENT', 'ABC-123')).toBe(
      'document:abc-123'
    );
    expect(driveShareProvenanceKey('document', 'abc-123')).toBe(
      'document:abc-123'
    );
  });

  it('classifies direct and DM shares separately from team and channel shares', () => {
    const direct = makeProv('1', 'direct');
    const dm = makeProv('2', 'dm');
    const channel = makeProv('3', 'channel', { channelName: 'design' });
    const team = makeProv('4', 'team', { teamName: 'Core' });

    expect(isDirectShareProvenance(direct)).toBe(true);
    expect(isDirectShareProvenance(dm)).toBe(true);
    expect(isDirectShareProvenance(channel)).toBe(false);
    expect(isDirectShareProvenance(team)).toBe(false);

    expect(matchesDriveShareScope('direct', direct)).toBe(true);
    expect(matchesDriveShareScope('direct', dm)).toBe(true);
    expect(matchesDriveShareScope('direct', channel)).toBe(false);
    expect(matchesDriveShareScope('team_or_channel', channel)).toBe(true);
    expect(matchesDriveShareScope('team_or_channel', team)).toBe(true);
    expect(matchesDriveShareScope('team_or_channel', dm)).toBe(false);
    expect(matchesDriveShareScope('direct', undefined, false)).toBe(false);
    expect(matchesDriveShareScope('direct', undefined, true)).toBe(true);
  });

  it('partitions shared items into Shared directly and Team & Channels sections', () => {
    const items = [
      { id: '1', name: 'Direct Doc' },
      { id: '2', name: 'Channel Doc' },
      { id: '3', name: 'DM Doc' },
      { id: '4', name: 'Team Doc' },
    ];
    const map = new Map<string, DriveShareProvenance>([
      ['1', makeProv('1', 'direct')],
      ['2', makeProv('2', 'channel', { channelName: 'engineering' })],
      ['3', makeProv('3', 'dm')],
      ['4', makeProv('4', 'team', { teamName: 'Acme' })],
    ]);

    const result = partitionSharedByProvenance(items, (item) =>
      map.get(item.id)
    );
    expect(result.hasResolvedProvenance).toBe(true);
    expect(result.groups.map((g) => g.bucket)).toEqual([
      'direct',
      'team_or_channel',
    ]);
    expect(result.groups[0].items.map((i) => i.id)).toEqual(['1', '3']);
    expect(result.groups[1].items.map((i) => i.id)).toEqual(['2', '4']);
  });

  it('reports hasResolvedProvenance=false when provenance has not loaded yet', () => {
    const result = partitionSharedByProvenance([{ id: '1' }], () => undefined);
    expect(result.hasResolvedProvenance).toBe(false);
    expect(result.groups).toHaveLength(1);
    expect(result.groups[0].bucket).toBe('team_or_channel');
  });
});
