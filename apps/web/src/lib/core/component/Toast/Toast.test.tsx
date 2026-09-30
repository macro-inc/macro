/** @vitest-environment jsdom */
import { afterEach, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  show: vi.fn(),
  dismiss: vi.fn(),
}));
vi.mock('@kobalte/core/toast', () => ({
  Toast: () => undefined,
  toaster: { show: mocks.show, dismiss: mocks.dismiss },
}));
vi.mock('@core/mobile/isMobile', () => ({ isMobile: () => false }));
vi.mock('@ui', () => ({
  Button: () => undefined,
  Surface: () => undefined,
  cn: () => '',
}));

import { toast } from './Toast';

afterEach(() => vi.useRealTimers());

it('keeps separate persistent failures visible across transient notifications', () => {
  vi.useFakeTimers();
  let nextId = 0;
  mocks.show.mockImplementation(() => ++nextId);
  const first = toast.failure('Draft could not be saved', { persistent: true });
  expect(first).toBe(1);
  const second = toast.failure('Draft could not be saved', {
    persistent: true,
  });
  expect(second).toBe(2);
  toast.success('Copied');
  toast.alert('Another notification');
  expect(mocks.dismiss).not.toHaveBeenCalledWith(first);
  expect(mocks.dismiss).not.toHaveBeenCalledWith(second);
  expect(mocks.dismiss).toHaveBeenCalledWith(3);
  toast.dismiss(first!);
  toast.dismiss(second!);
  expect(mocks.dismiss).toHaveBeenCalledWith(first);
  expect(mocks.dismiss).toHaveBeenCalledWith(second);
});
