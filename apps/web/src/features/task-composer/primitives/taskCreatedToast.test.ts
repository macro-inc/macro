import { toast } from '@core/component/Toast/Toast';
import { isTouchDevice } from '@core/mobile/isTouchDevice';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { showTaskCreatedToast } from './taskCreatedToast';

vi.mock('@core/component/Toast/Toast', () => ({
  toast: { success: vi.fn(), failure: vi.fn(), dismiss: vi.fn() },
}));
vi.mock('@core/mobile/isTouchDevice', () => ({ isTouchDevice: vi.fn() }));

const writeText = vi.fn();
const openTask = vi.fn();
const originalClipboard = Object.getOwnPropertyDescriptor(
  navigator,
  'clipboard'
);
beforeEach(() => {
  Object.defineProperty(navigator, 'clipboard', {
    configurable: true,
    value: { writeText },
  });
});
afterEach(() => {
  vi.resetAllMocks();
  if (originalClipboard)
    Object.defineProperty(navigator, 'clipboard', originalClipboard);
  else Reflect.deleteProperty(navigator, 'clipboard');
});

it('announces the task while the clipboard write is still pending', () => {
  writeText.mockReturnValue(new Promise<void>(() => {}));

  showTaskCreatedToast('task-1', undefined, openTask);

  expect(toast.success).toHaveBeenCalledTimes(1);
});

it('opens the created task from the toast and copies its link', () => {
  writeText.mockResolvedValue(undefined);
  vi.mocked(toast.success).mockReturnValue(7);

  showTaskCreatedToast('task-1', undefined, openTask);

  expect(writeText).toHaveBeenCalledWith(
    expect.stringMatching(/\/task\/task-1$/)
  );
  const [, options] = vi.mocked(toast.success).mock.calls[0];
  options?.actions?.find((action) => action.label === 'Open')?.onClick();
  expect(openTask).toHaveBeenCalledWith(
    { id: 'task-1', optimisticSnapshot: undefined },
    { newSplit: false, referredFrom: null }
  );
  expect(toast.dismiss).toHaveBeenCalledWith(7);
  expect(vi.mocked(toast.dismiss).mock.invocationCallOrder[0]).toBeLessThan(
    openTask.mock.invocationCallOrder[0]
  );
});

it('offers a new split on desktop and dismisses the toast before opening it', () => {
  writeText.mockResolvedValue(undefined);
  vi.mocked(isTouchDevice).mockReturnValue(false);
  vi.mocked(toast.success).mockReturnValue(7);

  showTaskCreatedToast('task-1', undefined, openTask);

  const [, options] = vi.mocked(toast.success).mock.calls[0];
  expect(options?.actions?.map((action) => action.label)).toEqual([
    'Open',
    'Open (New Split)',
  ]);
  options?.actions
    ?.find((action) => action.label === 'Open (New Split)')
    ?.onClick();
  expect(toast.dismiss).toHaveBeenCalledWith(7);
  expect(openTask).toHaveBeenCalledWith(
    { id: 'task-1', optimisticSnapshot: undefined },
    { newSplit: true, referredFrom: null }
  );
  expect(vi.mocked(toast.dismiss).mock.invocationCallOrder[0]).toBeLessThan(
    openTask.mock.invocationCallOrder[0]
  );
});

it('leaves out the new split action on touch devices', () => {
  writeText.mockResolvedValue(undefined);
  vi.mocked(isTouchDevice).mockReturnValue(true);

  showTaskCreatedToast('task-1', undefined, openTask);

  const [, options] = vi.mocked(toast.success).mock.calls[0];
  expect(options?.actions?.map((action) => action.label)).toEqual(['Open']);
});

it('keeps the task toast when the clipboard denies the write', async () => {
  const denial = new DOMException('denied', 'NotAllowedError');
  const deniedWrite = Promise.reject(denial);
  writeText.mockReturnValue(deniedWrite);

  showTaskCreatedToast('task-1', undefined, openTask);
  // The helper awaited this promise first, so its rejection handling has run.
  await expect(deniedWrite).rejects.toBe(denial);

  expect(toast.success).toHaveBeenCalledTimes(1);
  expect(toast.failure).not.toHaveBeenCalled();
});
