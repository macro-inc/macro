import { describe, expect, it } from 'vitest';
import { parseActor } from './actor';

describe('parseActor', () => {
  it('parses users from macro ids', () => {
    expect(parseActor('macro|sarah@example.com')).toEqual({
      kind: 'user',
      id: 'macro|sarah@example.com',
    });
  });

  it('parses bots from bot principals', () => {
    expect(parseActor('bot|00000000-0000-0000-0000-00000000a1a1')).toEqual({
      kind: 'bot',
      botId: '00000000-0000-0000-0000-00000000a1a1',
    });
  });

  it('keeps anything else raw', () => {
    expect(parseActor('system:nightly')).toEqual({
      kind: 'unknown',
      raw: 'system:nightly',
    });
    expect(parseActor('bot|')).toEqual({ kind: 'unknown', raw: 'bot|' });
    expect(parseActor('macro|no-at-sign')).toEqual({
      kind: 'unknown',
      raw: 'macro|no-at-sign',
    });
  });

  it('recognizes canonical, non-nil external attribution without a user identity', () => {
    expect(parseActor('external|01900000-0000-7000-8000-000000000001')).toEqual(
      {
        kind: 'external',
      }
    );
  });

  it.each([
    'external|',
    'external|customer@example.com',
    'external|not-a-uuid',
    'external|00000000-0000-0000-0000-000000000000',
    'external|01900000-0000-7000-8000-00000000000A',
    'external|01900000000070008000000000000001',
  ])('keeps malformed external attribution unknown: %s', (id) => {
    expect(parseActor(id)).toEqual({ kind: 'unknown', raw: id });
  });
});
