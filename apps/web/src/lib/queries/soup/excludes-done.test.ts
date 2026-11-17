import { describe, expect, it } from 'vitest';
import { soupQueryExcludesDone } from './excludes-done';

// Query keys carry the compiled filter body; done-excluding views embed
// `emailView: 'inbox'` or a compiled `*Done: false` literal.
describe('soupQueryExcludesDone', () => {
  it('recognizes done-excluding views and active-state filters', () => {
    const cases = [
      [{ emailView: 'inbox' }],
      [
        {
          ef: [
            {
              '|': [
                { l: { NotificationState: 'unseen' } },
                { l: { NotificationState: 'seen' } },
              ],
            },
          ],
        },
      ],
      [{ df: [{ '|': [{ l: { ns: 'unseen' } }, { l: { ns: 'seen' } }] }] }],
    ];
    for (const key of cases) expect(soupQueryExcludesDone(key)).toBe(true);
  });

  it('keeps done-inclusive views', () => {
    expect(soupQueryExcludesDone([{ emailView: 'all' }])).toBe(false);
  });

  it('does not treat negated or mixed-OR state filters as active-only', () => {
    const active = { l: { ns: 'unseen' } };
    const cases = [
      { '!': active },
      { '|': [active, { l: { ns: 'done' } }] },
      { '|': [active, { l: { id: 'e-1' } }] },
      { l: { ns: 'done' } },
    ];
    for (const ast of cases)
      expect(soupQueryExcludesDone([{ df: ast }])).toBe(false);
  });
});
