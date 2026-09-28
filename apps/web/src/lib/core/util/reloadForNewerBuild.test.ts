import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@core/component/Toast/Toast', () => ({
  toast: { success: vi.fn() },
}));

import {
  type ReloadPage,
  reloadForNewerBuild,
  resetReloadForNewerBuildForTests,
} from './reloadForNewerBuild';

function fakePage(state: { hidden: boolean; offline: boolean }) {
  const hiddenCallbacks: Array<() => void> = [];
  const onlineCallbacks: Array<() => void> = [];
  const prompts: Array<() => void> = [];
  const page: ReloadPage & { reload: ReturnType<typeof vi.fn> } = {
    isHidden: () => state.hidden,
    isOffline: () => state.offline,
    reload: vi.fn<() => void>(),
    onceHidden: (callback) => hiddenCallbacks.push(callback),
    onceOnline: (callback) => onlineCallbacks.push(callback),
    promptReload: (reload) => prompts.push(reload),
  };
  return {
    page,
    prompts,
    hide() {
      state.hidden = true;
      for (const callback of hiddenCallbacks.splice(0)) callback();
    },
    goOnline() {
      state.offline = false;
      for (const callback of onlineCallbacks.splice(0)) callback();
    },
  };
}

describe('reloadForNewerBuild', () => {
  beforeEach(() => {
    resetReloadForNewerBuildForTests();
  });

  it('reloads a hidden tab right away', () => {
    const { page, prompts } = fakePage({ hidden: true, offline: false });

    reloadForNewerBuild(page);

    expect(page.reload).toHaveBeenCalledOnce();
    expect(prompts).toEqual([]);
  });

  it('prompts on the visible tab and reloads when the user switches away', () => {
    const { page, prompts, hide } = fakePage({ hidden: false, offline: false });

    reloadForNewerBuild(page);

    expect(page.reload).not.toHaveBeenCalled();
    expect(prompts).toHaveLength(1);
    hide();
    expect(page.reload).toHaveBeenCalledOnce();
    // Accepting the prompt afterwards cannot reload a second time.
    prompts[0]?.();
    expect(page.reload).toHaveBeenCalledOnce();
  });

  it('reloads from the prompt without waiting to be hidden', () => {
    const { page, prompts, hide } = fakePage({ hidden: false, offline: false });

    reloadForNewerBuild(page);
    prompts[0]?.();
    hide();

    expect(page.reload).toHaveBeenCalledOnce();
  });

  it('waits until the device is online again', () => {
    const { page, goOnline } = fakePage({ hidden: true, offline: true });

    reloadForNewerBuild(page);

    expect(page.reload).not.toHaveBeenCalled();
    goOnline();
    expect(page.reload).toHaveBeenCalledOnce();
  });

  it('schedules one reload however many times the cache asks', () => {
    const first = fakePage({ hidden: false, offline: false });
    const second = fakePage({ hidden: true, offline: false });

    reloadForNewerBuild(first.page);
    reloadForNewerBuild(second.page);

    expect(first.prompts).toHaveLength(1);
    expect(second.page.reload).not.toHaveBeenCalled();
  });
});
