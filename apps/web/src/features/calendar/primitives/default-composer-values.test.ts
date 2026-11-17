import { describe, expect, it } from 'vitest';
import { defaultComposerValues } from './default-composer-values';

describe('new composer defaults', () => {
  it.each([
    ['2030-01-01T09:08:00', '2030-01-01T09:30', '2030-01-01T10:00'],
    ['2030-01-01T09:30:00', '2030-01-01T10:00', '2030-01-01T10:30'],
    ['2030-01-31T23:59:59', '2030-02-01T00:00', '2030-02-01T00:30'],
  ])('starts after %s at the next half hour', (now, start, end) => {
    expect(defaultComposerValues(new Date(now), false)).toMatchObject({
      start,
      end,
      allDay: false,
      conference: 'none',
    });
  });

  it('keeps the resolved call default without adding any guests or metadata', () => {
    expect(
      defaultComposerValues(new Date('2030-01-01T09:08:00'), true)
    ).toMatchObject({
      conference: 'macro',
      title: '',
      guests: '',
      description: '',
    });
  });
});
