import { describe, expect, it } from 'vitest';
import { anythingInFlight } from '../import';

describe('anythingInFlight', () => {
  it('counts a run that is importing before any row is claimed', () => {
    expect(
      anythingInFlight({
        runs: [
          {
            source: 'notion',
            status: 'importing',
            updated_at: '2026-11-06T12:00:00Z',
          },
        ],
        entities: [],
      })
    ).toBe(true);
  });

  it('stops once every run has settled', () => {
    expect(
      anythingInFlight({
        runs: [
          {
            source: 'linear',
            status: 'completed',
            updated_at: '2026-11-06T12:00:00Z',
          },
        ],
        entities: [],
      })
    ).toBe(false);
  });
});
