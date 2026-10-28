import type { EntityData } from '@entity/types/entity';
import { describe, expect, it } from 'vitest';
import { soupPageTimestamp } from './page-timestamp';

const entity: EntityData = {
  type: 'chat',
  id: 'chat',
  name: 'Chat',
  ownerId: 'alice',
  updatedAt: '2026-09-10T12:00:00Z',
  touchedAt: '2026-09-08T12:00:00Z',
  notifiedAt: '2026-09-09T12:00:00Z',
};

describe('fetched Soup page coverage', () => {
  it('uses the requested source timestamp rather than content freshness', () => {
    expect(soupPageTimestamp([entity], 'touched_by_me')).toBe(
      Date.parse(entity.touchedAt as string)
    );
    expect(soupPageTimestamp([entity], 'notified_at')).toBe(
      Date.parse(entity.notifiedAt as string)
    );
    expect(soupPageTimestamp([entity], 'updated_at')).toBe(
      Date.parse(entity.updatedAt as string)
    );
  });

  it('uses the oldest source stamp and skips unstamped cache inserts', () => {
    expect(
      soupPageTimestamp(
        [
          entity,
          { ...entity, id: 'older', touchedAt: '2026-09-01T00:00:00Z' },
          { ...entity, id: 'unstamped', touchedAt: undefined },
        ],
        'touched_by_me'
      )
    ).toBe(Date.parse('2026-09-01T00:00:00Z'));
  });

  it('keeps unknown and nonchronological coverage undefined', () => {
    expect(soupPageTimestamp([], 'notified_at')).toBeUndefined();
    expect(
      soupPageTimestamp([{ ...entity, notifiedAt: undefined }], 'notified_at')
    ).toBeUndefined();
    expect(soupPageTimestamp([entity], 'frecency')).toBeUndefined();
  });
});
