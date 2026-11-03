import { render } from '@solidjs/testing-library';
import { afterEach, expect, it, vi } from 'vitest';
import { LoadingPanel } from './LoadingSpinner';

afterEach(() => vi.useRealTimers());

it('cancels its delayed decoration when the loading panel unmounts', () => {
  vi.useFakeTimers();
  const view = render(() => <LoadingPanel />);
  expect(vi.getTimerCount()).toBe(1);
  view.unmount();
  expect(vi.getTimerCount()).toBe(0);
});
