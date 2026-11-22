import type { MessageTimelinePage } from '@service-storage/messages';
import { beforeEach, describe, expect, it } from 'vitest';
import { mapChannelTimelineEntry } from '../map';
import {
  forgetSendInHand,
  noteSendInHand,
  resetSendsInHand,
  SEND_IN_HAND_MAX_AGE_MS,
  withSendsInHand,
} from '../sends-in-hand';
import { CHANNEL_ID, graphqlMessage } from './fixtures';

const pageOf = (
  rows: ReturnType<typeof graphqlMessage>[],
  previousCursor: MessageTimelinePage['previous_cursor'] = null
): MessageTimelinePage => ({
  entries: rows.flatMap((row) => mapChannelTimelineEntry(row) ?? []),
  next_cursor: null,
  previous_cursor: previousCursor,
});

const idsOf = (page: MessageTimelinePage) =>
  page.entries.flatMap((entry) =>
    entry.type === 'activity' ? [] : [entry.message.id]
  );

describe('withSendsInHand', () => {
  beforeEach(resetSendsInHand);

  const placed = graphqlMessage(1);
  const first = graphqlMessage(2);
  const second = graphqlMessage(3);

  it('leaves a page alone while nothing is being sent', () => {
    const page = pageOf([placed]);
    expect(withSendsInHand(CHANNEL_ID, page)).toBe(page);
  });

  it('puts the messages being sent after everything placed, in the order sent', () => {
    noteSendInHand(first);
    noteSendInHand(second);
    const page = withSendsInHand(CHANNEL_ID, pageOf([placed]));
    // Newest first.
    expect(idsOf(page)).toEqual([second.id, first.id, placed.id]);
  });

  it('does not repeat a message the page already carries', () => {
    noteSendInHand(first);
    const page = pageOf([first, placed]);
    expect(withSendsInHand(CHANNEL_ID, page)).toBe(page);
  });

  it('keeps them off a page that stops short of the newest message', () => {
    noteSendInHand(first);
    const page = pageOf([placed], {
      created_at: placed.createdAt,
      id: placed.id,
    });
    expect(withSendsInHand(CHANNEL_ID, page)).toBe(page);
  });

  it('keeps them off another channel and leaves replies to their thread', () => {
    noteSendInHand(first);
    noteSendInHand(graphqlMessage(4, { threadId: placed.id }));
    const elsewhere = pageOf([]);
    expect(withSendsInHand('another-channel', elsewhere)).toBe(elsewhere);
    expect(idsOf(withSendsInHand(CHANNEL_ID, pageOf([placed])))).toEqual([
      first.id,
      placed.id,
    ]);
  });

  it('stops after a minute for a send it never hears of again', () => {
    noteSendInHand(first, 1_000);
    const page = pageOf([placed]);
    const late = 1_000 + SEND_IN_HAND_MAX_AGE_MS;
    expect(idsOf(withSendsInHand(CHANNEL_ID, page, late))).toHaveLength(2);
    expect(withSendsInHand(CHANNEL_ID, page, late + 1)).toBe(page);
    // Dropped for good, not hidden.
    expect(withSendsInHand(CHANNEL_ID, page, 1_000)).toBe(page);
  });

  it('stops once the send is delivered or refused', () => {
    noteSendInHand(first);
    forgetSendInHand(first.id);
    const page = pageOf([placed]);
    expect(withSendsInHand(CHANNEL_ID, page)).toBe(page);
  });
});
