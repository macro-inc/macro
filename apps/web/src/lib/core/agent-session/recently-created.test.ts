/**
 * The window in which this tab's own create explains a refusal.
 */

import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  createdRecently,
  forgetSessionCreated,
  markSessionCreated,
} from './recently-created';

const SESSION = '01a0abed-279f-724c-9f49-60dbedc79b6e';
const OTHER = '01a0abed-279f-724c-9f49-60dbedc79b6f';

afterEach(() => {
  vi.useRealTimers();
  forgetSessionCreated(SESSION);
  forgetSessionCreated(OTHER);
});

describe('recently created sessions', () => {
  it('knows a session this tab created from one it only opened', () => {
    markSessionCreated(SESSION);

    expect(createdRecently(SESSION)).toBe(true);
    expect(createdRecently(OTHER)).toBe(false);
  });

  it('stops vouching for a create once the window has passed', () => {
    vi.useFakeTimers();
    markSessionCreated(SESSION);
    expect(createdRecently(SESSION)).toBe(true);

    vi.advanceTimersByTime(30_000);

    expect(createdRecently(SESSION)).toBe(false);
  });

  it('forgets a session on request, so a later refusal is taken at its word', () => {
    markSessionCreated(SESSION);

    forgetSessionCreated(SESSION);

    expect(createdRecently(SESSION)).toBe(false);
  });

  it('does not grow without bound as sessions are created', () => {
    vi.useFakeTimers();
    markSessionCreated(OTHER);

    vi.advanceTimersByTime(30_000);
    // Any later create prunes what the window has left behind.
    markSessionCreated(SESSION);

    expect(createdRecently(OTHER)).toBe(false);
    expect(createdRecently(SESSION)).toBe(true);
  });
});
