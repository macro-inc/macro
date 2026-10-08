import { toast } from '@core/component/Toast/Toast';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { useCopyLink } from './useCopyLink';

vi.mock('@core/context/user', () => ({
  useReferralCode: () => () => 'ref-code',
}));
vi.mock('@core/component/Toast/Toast', () => ({
  toast: { success: vi.fn(), failure: vi.fn() },
}));

const writeText = vi.fn();
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
  vi.restoreAllMocks();
  vi.resetAllMocks();
  if (originalClipboard)
    Object.defineProperty(navigator, 'clipboard', originalClipboard);
  else Reflect.deleteProperty(navigator, 'clipboard');
});

it('waits for clipboard success and preserves informational toast detail', async () => {
  let complete!: () => void;
  writeText.mockReturnValue(
    new Promise<void>((resolve) => (complete = resolve))
  );
  const result = useCopyLink()('https://macro.com/app/task/task-1', {
    subtext: 'Only people with access can open this link.',
  });
  expect(writeText).toHaveBeenCalledWith(
    'https://macro.com/app/task/task-1?referral_code=ref-code'
  );
  expect(toast.success).not.toHaveBeenCalled();
  complete();
  expect(await result).toBe(true);
  expect(toast.success).toHaveBeenCalledWith('Link copied to clipboard.', {
    subtext: 'Only people with access can open this link.',
  });
});

it('returns false on clipboard failure without showing success', async () => {
  writeText.mockRejectedValue(new Error('Clipboard unavailable'));
  expect(await useCopyLink()('https://macro.com/app/task/task-1')).toBe(false);
  expect(toast.success).not.toHaveBeenCalled();
  expect(toast.failure).toHaveBeenCalledWith('Could not copy link');
});

it('keeps silent copies silent', async () => {
  writeText.mockResolvedValue(undefined);
  expect(
    await useCopyLink()('https://macro.com/app/task/task-1', { silent: true })
  ).toBe(true);
  expect(toast.success).not.toHaveBeenCalled();
});
