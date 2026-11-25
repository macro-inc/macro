/**
 * @vitest-environment jsdom
 */

import { render } from '@solidjs/testing-library';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { MessageTime } from '../MessageTime';

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date(2026, 10, 25, 23, 59, 55));
});

afterEach(() => {
  vi.useRealTimers();
});

const SENT_AT = new Date(2026, 10, 25, 14, 33);
const timeAlone = SENT_AT.toLocaleTimeString(undefined, { timeStyle: 'short' });

it('stops showing the time alone once the day it was sent on is over', () => {
  const { container } = render(() => (
    <MessageTime at={SENT_AT.toISOString()} />
  ));
  expect(container.textContent).toBe(timeAlone);

  vi.advanceTimersByTime(5_000);

  expect(container.textContent).toBe(`Yesterday at ${timeAlone}`);
});

it('catches up with the day when a tab whose timers were held shows again', () => {
  const { container } = render(() => (
    <MessageTime at={SENT_AT.toISOString()} />
  ));

  vi.setSystemTime(new Date(2026, 10, 26, 9, 0));
  document.dispatchEvent(new Event('visibilitychange'));

  expect(container.textContent).toBe(`Yesterday at ${timeAlone}`);
});
