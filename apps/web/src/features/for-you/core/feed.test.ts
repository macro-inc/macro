import { describe, expect, it } from 'vitest';
import { TEST_ITEMS } from '../tests/fixtures';
import {
  feedItemSchema,
  feedSchema,
  feedSourceLabel,
  interleaveFeed,
} from './feed';

describe('feed presentation', () => {
  it('keeps cached untagged recommendations readable without guessing financial benefits', () => {
    const cached = feedItemSchema
      .omit({ moneyCategories: true })
      .parse(TEST_ITEMS[0]);
    expect(
      feedSchema.parse({ items: [cached] }).items[0]?.moneyCategories
    ).toEqual([]);
  });
  it('interleaves ideas with ranked work while keeping every recommendation', () => {
    expect(interleaveFeed(TEST_ITEMS).map((item) => item.id)).toEqual([
      'reply-needed',
      'account-agent',
      'unfinished-review',
      'pipeline-database',
      'weekly-routine',
    ]);
  });
  it('keeps work order when there are no ideas', () => {
    const work = TEST_ITEMS.filter((item) => item.kind !== 'idea');
    expect(interleaveFeed(work)).toEqual(work);
  });
  it('uses the email subject without transport labels and repeated reply prefixes', () => {
    expect(feedSourceLabel('Email thread: Re: Fwd: Re: Launch decision')).toBe(
      'Launch decision'
    );
    expect(feedSourceLabel('Project plan')).toBe('Project plan');
  });
});
