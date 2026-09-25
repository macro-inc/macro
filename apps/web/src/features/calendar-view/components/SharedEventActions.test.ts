import { describe, expect, it } from 'vitest';
import { icsFileName } from './SharedEventActions';

describe('icsFileName', () => {
  it('slugifies the event title', () => {
    expect(icsFileName('Q3 Planning: Kickoff!')).toBe(
      'q3-planning-kickoff.ics'
    );
  });

  it('falls back when the title has no usable characters', () => {
    expect(icsFileName('  ✨ ')).toBe('event.ics');
    expect(icsFileName('')).toBe('event.ics');
  });

  it('caps long titles', () => {
    expect(icsFileName('a'.repeat(100))).toBe(`${'a'.repeat(60)}.ics`);
  });
});
