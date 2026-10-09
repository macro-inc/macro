import { describe, expect, it } from 'vitest';
import { homeWorkFeedScope } from './home-scope';

const everything = { calendar: true, foreignEntities: true, snippets: false };

describe('homeWorkFeedScope', () => {
  it('asks for every kind when no type filter is selected', () => {
    expect(homeWorkFeedScope(undefined, everything)).toEqual({
      mode: 'work',
      types: [],
      includeSnippets: false,
    });
  });

  it('leaves out kinds this client cannot show', () => {
    const scope = homeWorkFeedScope([], {
      calendar: false,
      foreignEntities: false,
      snippets: true,
    });
    expect(scope?.types).not.toContain('calendar_event');
    expect(scope?.types).not.toContain('pull_request');
    expect(scope?.types).toContain('channel_thread');
    expect(scope?.includeSnippets).toBe(true);
  });

  it('maps type filters to item kinds', () => {
    expect(homeWorkFeedScope(['tasks', 'channels'], everything)?.types).toEqual(
      ['document', 'channel', 'channel_thread']
    );
  });

  it('has no scope when the filters leave nothing to show', () => {
    expect(homeWorkFeedScope(['none'], everything)).toBeUndefined();
    expect(
      homeWorkFeedScope(['calendar'], { ...everything, calendar: false })
    ).toBeUndefined();
  });
});
