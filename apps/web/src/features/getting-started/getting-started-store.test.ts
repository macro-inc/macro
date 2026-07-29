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
    });
  });

  it('defaults missing fields to empty arrays', () => {
    expect(parseGettingStartedSnapshot('{}')).toEqual({
      completedActionIds: [],
      collapsedSectionIds: [],
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
    });
  });

  it('keeps ids the current config does not know', () => {
    expect(
      parseGettingStartedSnapshot('{"completedActionIds":["renamed-action"]}')
    ).toEqual({
      completedActionIds: ['renamed-action'],
      collapsedSectionIds: [],
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
});
