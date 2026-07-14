import { describe, expect, it } from 'vitest';
import {
  fuzzyMatch,
  fuzzyScoreCommaSpaceSeparated,
  fuzzyTestCommaSpaceSeparated,
  highlightCommaSpaceSeparatedMatches,
} from './fuzzy';

interface TestItem {
  id: string;
  name: string;
  type?: string;
}

describe('fuzzyTestCommaSpaceSeparated', () => {
  it('matches comma-separated query terms', () => {
    expect(
      fuzzyTestCommaSpaceSeparated('nick,hutch', 'Nick Noble,teo,hutch')
    ).toBe(true);
  });

  it('matches space-separated query terms', () => {
    expect(
      fuzzyTestCommaSpaceSeparated(
        'jackson jacob',
        'jacob, jackson kustec, gabriel'
      )
    ).toBe(true);
  });

  it('matches regardless of order', () => {
    expect(
      fuzzyTestCommaSpaceSeparated('teo,nick', 'Nick Noble,teo,hutch')
    ).toBe(true);
    expect(
      fuzzyTestCommaSpaceSeparated(
        'jacob jackson',
        'jackson kustec, jacob, gabriel'
      )
    ).toBe(true);
  });

  it('matches single query term against multi-part name', () => {
    expect(fuzzyTestCommaSpaceSeparated('teo', 'Nick Noble,teo,hutch')).toBe(
      true
    );
  });

  it('does not match when a query part is missing', () => {
    expect(
      fuzzyTestCommaSpaceSeparated('nick,alice', 'Nick Noble,teo,hutch')
    ).toBe(false);
  });

  it('handles fuzzy matching within parts', () => {
    expect(
      fuzzyTestCommaSpaceSeparated('nob,teo', 'Nick Noble,teo,hutch')
    ).toBe(true);
  });

  it('handles whitespace around commas', () => {
    expect(
      fuzzyTestCommaSpaceSeparated('nick , hutch', 'Nick Noble , teo , hutch')
    ).toBe(true);
  });

  it('returns true for empty query', () => {
    expect(fuzzyTestCommaSpaceSeparated('', 'Nick Noble,teo,hutch')).toBe(true);
  });
});

describe('fuzzyScoreCommaSpaceSeparated', () => {
  it('returns score between 0 and 1 with comma-separated query', () => {
    const score = fuzzyScoreCommaSpaceSeparated(
      'nick,teo',
      'Nick Noble,teo,hutch'
    );
    expect(score).toBeGreaterThan(0);
    expect(score).toBeLessThanOrEqual(1);
  });

  it('matches space-separated query terms in any order', () => {
    const score = fuzzyScoreCommaSpaceSeparated(
      'jackson jacob',
      'jackson kustec, gabriel birman, jacob, eric hayes'
    );
    expect(score).toBeGreaterThan(0);
    expect(score).toBeLessThanOrEqual(1);
  });

  it('matches when query terms are reversed', () => {
    const score = fuzzyScoreCommaSpaceSeparated(
      'jacob jackson',
      'jackson kustec, gabriel birman, jacob, eric hayes'
    );
    expect(score).toBeGreaterThan(0);
    expect(score).toBeLessThanOrEqual(1);
  });

  it('matches mixed space and comma query', () => {
    const score = fuzzyScoreCommaSpaceSeparated(
      'jackson, jacob',
      'jackson kustec, gabriel birman, jacob, eric hayes'
    );
    expect(score).toBeGreaterThan(0);
  });

  it('returns -1 when no match', () => {
    const score = fuzzyScoreCommaSpaceSeparated(
      'alice,bob',
      'Nick Noble,teo,hutch'
    );
    expect(score).toBe(-1);
  });

  it('returns -1 when a term does not match (space-separated)', () => {
    const score = fuzzyScoreCommaSpaceSeparated(
      'jackson alice',
      'jackson kustec, gabriel birman, jacob, eric hayes'
    );
    expect(score).toBe(-1);
  });

  it('returns 1 for empty query', () => {
    const score = fuzzyScoreCommaSpaceSeparated('', 'Nick Noble,teo,hutch');
    expect(score).toBe(1);
  });
});

describe('highlightCommaSpaceSeparatedMatches', () => {
  it('highlights comma-separated query terms', () => {
    const result = highlightCommaSpaceSeparatedMatches(
      'hutch,gab',
      'hutch, gab, eric'
    );
    expect(result).toContain('<macro_em>hutch</macro_em>');
    expect(result).toContain('<macro_em>gab</macro_em>');
  });

  it('highlights space-separated query terms', () => {
    const result = highlightCommaSpaceSeparatedMatches(
      'hutch gab',
      'hutch, gab, eric'
    );
    expect(result).toContain('<macro_em>hutch</macro_em>');
    expect(result).toContain('<macro_em>gab</macro_em>');
  });

  it('highlights terms in any order', () => {
    const result = highlightCommaSpaceSeparatedMatches(
      'jackson jacob',
      'jacob, jackson kustec, gabriel'
    );
    expect(result).toContain('<macro_em>jacob</macro_em>');
    expect(result).toContain('<macro_em>jackson</macro_em>');
  });

  it('highlights partial fuzzy matches', () => {
    const result = highlightCommaSpaceSeparatedMatches(
      'jac gab',
      'jacob, jackson kustec, gabriel'
    );
    expect(result).toContain('<macro_em>jac</macro_em>');
    expect(result).toContain('<macro_em>gab</macro_em>');
  });

  it('preserves comma separators in output', () => {
    const result = highlightCommaSpaceSeparatedMatches(
      'hutch gab',
      'hutch, gab, eric'
    );
    expect(result).toMatch(/,\s/);
  });

  it('returns original text for empty query', () => {
    const result = highlightCommaSpaceSeparatedMatches('', 'hutch, gab, eric');
    expect(result).toBe('hutch, gab, eric');
  });

  it('does not highlight unmatched terms', () => {
    const result = highlightCommaSpaceSeparatedMatches(
      'hutch',
      'hutch, gab, eric'
    );
    expect(result).toContain('<macro_em>hutch</macro_em>');
    expect(result).not.toContain('<macro_em>gab</macro_em>');
    expect(result).not.toContain('<macro_em>eric</macro_em>');
  });
});

describe('fuzzyMatch with delimiter-separated channel matching', () => {
  it('matches channels with space-separated query in any order', () => {
    const items: TestItem[] = [
      {
        id: '1',
        name: 'jackson kustec, gabriel birman, jacob, eric hayes',
        type: 'channel',
      },
      { id: '2', name: 'Other Channel', type: 'channel' },
    ];

    const results1 = fuzzyMatch('jackson jacob', items, (item) => item.name);
    expect(results1.length).toBe(1);
    expect(results1[0].item.id).toBe('1');
    expect(results1[0].nameHighlight).toContain('<macro_em>jackson</macro_em>');
    expect(results1[0].nameHighlight).toContain('<macro_em>jacob</macro_em>');

    const results2 = fuzzyMatch('jacob jackson', items, (item) => item.name);
    expect(results2.length).toBe(1);
    expect(results2[0].item.id).toBe('1');
  });

  it('uses regular fuzzy search for non-channel items', () => {
    const items: TestItem[] = [
      { id: '1', name: 'jackson document', type: 'document' },
      { id: '2', name: 'jacob notes', type: 'document' },
    ];

    const results = fuzzyMatch('jackson', items, (item) => item.name);
    expect(results.length).toBe(1);
    expect(results[0].item.id).toBe('1');
  });

  it('uses regular fuzzy search when query has no spaces or commas', () => {
    const items: TestItem[] = [
      { id: '1', name: 'jackson kustec, jacob', type: 'channel' },
      { id: '2', name: 'james', type: 'channel' },
    ];

    const results = fuzzyMatch('jack', items, (item) => item.name);
    expect(results.length).toBe(1);
    expect(results[0].item.id).toBe('1');
  });

  it('returns all items with no highlights when query is empty', () => {
    const items: TestItem[] = [
      { id: '1', name: 'Channel 1', type: 'channel' },
      { id: '2', name: 'Channel 2', type: 'channel' },
    ];

    const results = fuzzyMatch('', items, (item) => item.name);
    expect(results.length).toBe(2);
    expect(results[0].nameHighlight).toBe('Channel 1');
    expect(results[1].nameHighlight).toBe('Channel 2');
  });

  it('correctly orders non-channel items by match quality', () => {
    const items: TestItem[] = [
      { id: '1', name: 'test document', type: 'document' },
      { id: '2', name: 'test', type: 'document' },
      { id: '3', name: 'testing something else', type: 'document' },
    ];

    const results = fuzzyMatch('test', items, (item) => item.name);

    expect(results.length).toBe(3);
    expect(results[0].item.name).toBe('test');
    expect(results[1].item.name).toBe('test document');
    expect(results[2].item.name).toBe('testing something else');
  });

  it('correctly orders channels and non-channels by match quality with single-term query', () => {
    const items: TestItem[] = [
      { id: '1', name: 'design document', type: 'document' },
      { id: '2', name: 'design, alice, bob', type: 'channel' },
      { id: '3', name: 'design', type: 'document' },
      { id: '4', name: 'design team, charlie', type: 'channel' },
    ];

    const results = fuzzyMatch('design', items, (item) => item.name);

    expect(results.length).toBe(4);
    expect(results[0].item.name).toBe('design');
    expect(results[1].item.name).toBe('design document');
    expect(results[2].item.name).toBe('design team, charlie');
    expect(results[3].item.name).toBe('design, alice, bob');
  });

  it('correctly interleaves channels and non-channels by match quality with multi-term query', () => {
    const items: TestItem[] = [
      { id: '1', name: 'alice, bob', type: 'channel' },
      { id: '2', name: 'alice bob', type: 'document' },
      { id: '3', name: 'bob notes', type: 'document' },
      { id: '4', name: 'alice, charlie, bob', type: 'channel' },
    ];

    // Use space-separated query to trigger channel-specific matching
    const results = fuzzyMatch('alice bob', items, (item) => item.name);

    expect(results.length).toBe(3);
    expect(results[0].item.name).toBe('alice, bob');
    expect(results[1].item.name).toBe('alice, charlie, bob');
  });
});
