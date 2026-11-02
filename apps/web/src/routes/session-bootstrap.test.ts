/** @vitest-environment jsdom */
import { beforeEach, expect, it, vi } from 'vitest';

const { refresh, native } = vi.hoisted(() => ({
  refresh: vi.fn(async () => undefined),
  native: { value: false },
}));
vi.mock('@core/auth/session-refresh', () => ({ ensureFreshSession: refresh }));
vi.mock('@core/util/platform', () => ({ isTauri: () => native.value }));
beforeEach(() => {
  vi.resetModules();
  vi.clearAllMocks();
  localStorage.clear();
  document.cookie = 'login=false; path=/';
  native.value = false;
});

it('does not check a session without a login hint', async () => {
  await import('../session-bootstrap');
  expect(refresh).not.toHaveBeenCalled();
});

it.each(['cookie', 'storage'])(
  'starts shared refresh with a %s hint',
  async (hint) => {
    if (hint === 'cookie') document.cookie = 'login=true; path=/';
    else localStorage.setItem('macro:login', 'true');
    await import('../session-bootstrap');
    expect(refresh).toHaveBeenCalledOnce();
  }
);

it('leaves native startup to the installed session transport', async () => {
  native.value = true;
  localStorage.setItem('macro:login', 'true');
  await import('../session-bootstrap');
  expect(refresh).not.toHaveBeenCalled();
});
