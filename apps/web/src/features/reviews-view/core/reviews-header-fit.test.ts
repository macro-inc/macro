import { describe, expect, it } from 'vitest';
import { nextReviewsHeaderSteps } from './reviews-header-fit';

const fits = { overflow: 0, slack: 0 };

describe('Reviews header room', () => {
  it('keeps everything while the actions fit', () => {
    expect(
      nextReviewsHeaderSteps({ steps: 0, freed: [] }, 2, {
        overflow: 0,
        slack: 300,
      })
    ).toBe(0);
  });

  it('takes one step at a time while the actions overflow', () => {
    const overflow = { overflow: 40, slack: 0 };
    expect(nextReviewsHeaderSteps({ steps: 0, freed: [] }, 2, overflow)).toBe(
      1
    );
    expect(
      nextReviewsHeaderSteps({ steps: 1, freed: [150] }, 2, overflow)
    ).toBe(2);
    expect(
      nextReviewsHeaderSteps({ steps: 2, freed: [150, 106] }, 2, overflow)
    ).toBe(2);
  });

  it('undoes a step only when the room it freed is free again', () => {
    const room = { steps: 2, freed: [150, 106] };
    expect(nextReviewsHeaderSteps(room, 2, fits)).toBe(2);
    expect(nextReviewsHeaderSteps(room, 2, { overflow: 0, slack: 106 })).toBe(
      2
    );
    expect(nextReviewsHeaderSteps(room, 2, { overflow: 0, slack: 107 })).toBe(
      1
    );
    expect(
      nextReviewsHeaderSteps({ steps: 1, freed: [150] }, 2, {
        overflow: 0,
        slack: 151,
      })
    ).toBe(0);
  });

  it('stays put when the room a step freed is unknown', () => {
    expect(
      nextReviewsHeaderSteps({ steps: 1, freed: [] }, 2, {
        overflow: 0,
        slack: 500,
      })
    ).toBe(1);
  });

  it('never takes more steps than the header has', () => {
    // On the board there are no status tabs, only the scope name to hide.
    expect(
      nextReviewsHeaderSteps({ steps: 1, freed: [106] }, 1, {
        overflow: 30,
        slack: 0,
      })
    ).toBe(1);
  });
});
