/** @vitest-environment jsdom */
import { describe, expect, it } from 'vitest';
import type { ReviewItem } from '../core/review';
import { validateReviewDraft } from './review-draft-validation';

const email = {
  subject: 'Update',
  to: [{ email: 'recipient@example.com' }],
  body: '**Hello**',
};
const event = {
  title: 'Planning',
  time: {
    kind: 'timed',
    startsAt: '2026-10-20T10:00:00Z',
    endsAt: '2026-10-20T11:00:00Z',
  },
};
function item(draft: unknown): ReviewItem {
  return { id: 'draft', draft, status: 'pending' };
}
describe('review submission preflight', () => {
  it('accepts unvisited Markdown and composer HTML without rewriting either', () => {
    for (const body of ['**Hello**', btoa('<body><p>Hello</p></body>')]) {
      const draft = { ...email, body };
      expect(validateReviewDraft(item(draft), 'email')).toBeUndefined();
      expect(draft.body).toBe(body);
    }
  });
  it('rejects empty messages, missing recipients and invalid addresses', () => {
    for (const draft of [
      { ...email, body: '  ' },
      { ...email, body: btoa('<body><p><br></p></body>') },
      { ...email, to: [] },
      { ...email, cc: [{ email: 'bad-address' }] },
      { subject: 'Missing fields' },
    ])
      expect(validateReviewDraft(item(draft), 'email')).toBeTruthy();
  });
  it('accepts timed and all-day events and rejects impossible ranges', () => {
    expect(validateReviewDraft(item(event), 'calendar')).toBeUndefined();
    expect(
      validateReviewDraft(
        item({
          ...event,
          time: {
            kind: 'allDay',
            startDate: '2026-10-20',
            endDate: '2026-10-21',
          },
        }),
        'calendar'
      )
    ).toBeUndefined();
    for (const draft of [
      { ...event, title: '' },
      { ...event, time: { ...event.time, endsAt: event.time.startsAt } },
      {
        ...event,
        time: {
          kind: 'allDay',
          startDate: '2026-10-21',
          endDate: '2026-10-20',
        },
      },
      { ...event, attendees: [{ email: 'invalid' }] },
      { ...event, addConference: true, addMacroCall: true },
    ])
      expect(validateReviewDraft(item(draft), 'calendar')).toBeTruthy();
  });
});
