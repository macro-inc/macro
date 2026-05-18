import { describe, expect, test } from 'bun:test';
import { decideAddAlias } from './add_alias';

describe('decideAddAlias', () => {
  test('alias is currently a physical index — error (use swap script)', () => {
    const out = decideAddAlias({
      alias: 'channels',
      targetIndex: 'channels_v1',
      aliasAlreadyOnTarget: false,
      aliasIsPhysicalIndex: true,
    });
    expect(out.kind).toBe('error');
  });

  test('alias already on target — no-op', () => {
    const out = decideAddAlias({
      alias: 'emails',
      targetIndex: 'emails_v2',
      aliasAlreadyOnTarget: true,
      aliasIsPhysicalIndex: false,
    });
    expect(out.kind).toBe('noop');
  });

  test('alias does not exist anywhere — apply add', () => {
    const out = decideAddAlias({
      alias: 'emails',
      targetIndex: 'emails_v2',
      aliasAlreadyOnTarget: false,
      aliasIsPhysicalIndex: false,
    });
    expect(out.kind).toBe('apply');
    if (out.kind === 'apply') {
      expect(out.action).toEqual({
        add: { index: 'emails_v2', alias: 'emails' },
      });
    }
  });
});
