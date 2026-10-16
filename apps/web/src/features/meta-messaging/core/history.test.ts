import { describe, expect, it } from 'vitest';
import {
  historyActive,
  historyDescription,
  historyLabel,
  historyRecovery,
} from './history';

describe('history import scope and recovery', () => {
  it('only polls active imports and keeps successful delivery quiet', () => {
    expect(historyActive()).toBe(false);
    for (const status of ['pending', 'syncing'] as const)
      expect(historyActive({ status, unavailable_media: false })).toBe(true);
    for (const status of ['complete', 'failed', 'declined'] as const)
      expect(historyActive({ status, unavailable_media: false })).toBe(false);
    expect(historyLabel({ status: 'complete', unavailable_media: false })).toBe(
      'History imported'
    );
  });
  it('states provider limits before importing, including missing old media', () => {
    expect(historyDescription('whatsapp')).toContain('24 hours');
    expect(historyDescription('whatsapp')).toContain('14 days');
    expect(historyDescription('instagram')).toContain('latest 20');
    expect(historyDescription('instagram')).toContain('30 days');
  });
  it('does not recommend blindly repeating a one-time WhatsApp request', () => {
    expect(
      historyRecovery(
        { status: 'failed', unavailable_media: false },
        'whatsapp'
      )
    ).toContain('late history can still arrive');
    expect(
      historyRecovery(
        { status: 'failed', unavailable_media: false },
        'instagram'
      )
    ).toContain('resume');
  });
});
