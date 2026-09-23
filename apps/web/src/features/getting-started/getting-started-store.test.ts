import { describe, expect, it } from 'vitest';
import { parseGettingStartedSnapshot } from './getting-started-store';

describe('parseGettingStartedSnapshot', () => {
  it('parses a well-formed snapshot', () => {
    expect(
      parseGettingStartedSnapshot(
        '{"completedActionIds":["set-name"],"collapsedSectionIds":["basics"]}'
      )
    ).toEqual({
      completedActionIds: ['set-name'],
      collapsedSectionIds: ['basics'],
      chatIdsByAction: {},
    });
  });

  it('defaults missing fields to empty arrays', () => {
    expect(parseGettingStartedSnapshot('{}')).toEqual({
      completedActionIds: [],
      collapsedSectionIds: [],
      chatIdsByAction: {},
    });
  });

  it('drops non-string entries', () => {
    expect(
      parseGettingStartedSnapshot(
        '{"completedActionIds":["set-name",12,null],"collapsedSectionIds":[{}]}'
      )
    ).toEqual({
      completedActionIds: ['set-name'],
      collapsedSectionIds: [],
      chatIdsByAction: {},
    });
  });

  it('keeps ids the current config does not know', () => {
    expect(
      parseGettingStartedSnapshot('{"completedActionIds":["renamed-action"]}')
    ).toEqual({
      completedActionIds: ['renamed-action'],
      collapsedSectionIds: [],
      chatIdsByAction: {},
    });
  });

  it('returns null for non-object shapes', () => {
    expect(parseGettingStartedSnapshot('["set-name"]')).toBeNull();
    expect(parseGettingStartedSnapshot('"set-name"')).toBeNull();
    expect(parseGettingStartedSnapshot(null)).toBeNull();
  });

  it('returns null for malformed JSON', () => {
    expect(parseGettingStartedSnapshot('{')).toBeNull();
  });

  it('keeps valid chat mappings and drops invalid chat ids', () => {
    expect(
      parseGettingStartedSnapshot(
        JSON.stringify({
          chatIdsByAction: {
            brief: 'chat-1',
            tasks: 12,
            inbox: null,
            empty: '',
          },
        })
      )?.chatIdsByAction
    ).toEqual({ brief: 'chat-1' });
  });

  it.each([null, [], 'chat-1', 12])(
    'ignores malformed chat mappings: %j',
    (value) => {
      expect(
        parseGettingStartedSnapshot(JSON.stringify({ chatIdsByAction: value }))
          ?.chatIdsByAction
      ).toEqual({});
    }
  );
});
