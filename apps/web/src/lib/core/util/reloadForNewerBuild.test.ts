import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@core/component/Toast/Toast', () => ({
  toast: { custom: vi.fn() },
}));
vi.mock('@core/mobile/isTouchDevice', () => ({ isTouchDevice: () => false }));

import {
  holdAutomaticReload,
  pendingWebUpdate,
  promptReloadForFailedLoad,
  type ReloadOnce,
  type ReloadPage,
  recoverFromFailedLoad,
  reloadForNewerBuild,
  resetReloadForNewerBuildForTests,
} from './reloadForNewerBuild';

function fakePage(state: {
  hidden: boolean;
  offline: boolean;
  editingText?: boolean;
}) {
  const listeners: Array<() => void> = [];
  const prompts: Array<() => void> = [];
  const page: ReloadPage & { reload: ReturnType<typeof vi.fn> } = {
    isHidden: () => state.hidden,
    isOffline: () => state.offline,
    isEditingText: () => state.editingText ?? false,
    reload: vi.fn<() => void>(),
    onHiddenOrOnline: (callback) => listeners.push(callback),
    promptReload: (reload) => prompts.push(reload),
  };
  const notify = () => {
    for (const listener of listeners) listener();
  };
  return {
    page,
    prompts,
    state,
    hide() {
      state.hidden = true;
      notify();
    },
    show() {
      state.hidden = false;
    },
    goOnline() {
      state.offline = false;
      notify();
    },
  };
}

describe('reloadForNewerBuild', () => {
  beforeEach(() => {
    resetReloadForNewerBuildForTests();
  });

  it('reloads a hidden tab right away and still offers the reload', () => {
    const { page, prompts } = fakePage({ hidden: true, offline: false });

    reloadForNewerBuild(page);

    expect(page.reload).toHaveBeenCalledOnce();
    expect(prompts).toHaveLength(1);
  });

  it('prompts on the visible tab and reloads when the user switches away', () => {
    const { page, prompts, hide } = fakePage({ hidden: false, offline: false });

    reloadForNewerBuild(page);

    expect(page.reload).not.toHaveBeenCalled();
    expect(prompts).toHaveLength(1);
    hide();
    expect(page.reload).toHaveBeenCalledOnce();
  });

  it('reloads from the prompt without waiting to be hidden', () => {
    const { page, prompts } = fakePage({ hidden: false, offline: false });

    reloadForNewerBuild(page);
    prompts[0]?.();

    expect(page.reload).toHaveBeenCalledOnce();
  });

  it('waits until the device is online again, and only while hidden', () => {
    const hidden = fakePage({ hidden: true, offline: true });
    reloadForNewerBuild(hidden.page);
    expect(hidden.page.reload).not.toHaveBeenCalled();
    hidden.goOnline();
    expect(hidden.page.reload).toHaveBeenCalledOnce();

    resetReloadForNewerBuildForTests();
    const woken = fakePage({ hidden: true, offline: true });
    reloadForNewerBuild(woken.page);
    // The device wakes up with the tab in front: the user may be typing.
    woken.show();
    woken.goOnline();
    expect(woken.page.reload).not.toHaveBeenCalled();
    woken.hide();
    expect(woken.page.reload).toHaveBeenCalledOnce();
  });

  it('never reloads by itself during held work or while text is written', () => {
    const release = holdAutomaticReload();
    const { page, prompts, state, hide, show } = fakePage({
      hidden: true,
      offline: false,
      editingText: true,
    });

    reloadForNewerBuild(page);
    expect(page.reload).not.toHaveBeenCalled();

    release();
    show();
    hide();
    expect(page.reload).not.toHaveBeenCalled();

    state.editingText = false;
    show();
    hide();
    expect(page.reload).toHaveBeenCalledOnce();
    // The prompt still reloads whenever the user asks.
    prompts[0]?.();
    expect(page.reload).toHaveBeenCalledTimes(2);
  });

  it('schedules one reload however many times the cache asks', () => {
    const first = fakePage({ hidden: false, offline: false });
    const second = fakePage({ hidden: true, offline: false });

    reloadForNewerBuild(first.page);
    reloadForNewerBuild(second.page);

    expect(first.prompts).toHaveLength(1);
    expect(second.prompts).toHaveLength(0);
    expect(second.page.reload).not.toHaveBeenCalled();
  });
});

describe('promptReloadForFailedLoad', () => {
  beforeEach(() => {
    resetReloadForNewerBuildForTests();
  });

  it('offers the newer build and counts each failed load', () => {
    promptReloadForFailedLoad();
    promptReloadForFailedLoad();

    expect(pendingWebUpdate()?.failedLoads).toBe(2);
    expect(pendingWebUpdate()?.reload).toBeTypeOf('function');
  });
});

describe('recoverFromFailedLoad', () => {
  beforeEach(() => {
    resetReloadForNewerBuildForTests();
    sessionStorage.clear();
  });

  const reloadOnce = (): ReloadOnce & { claimed: Set<string> } => {
    const claimed = new Set<string>();
    return {
      claimed,
      claim(build) {
        if (claimed.has(build)) return false;
        claimed.add(build);
        return true;
      },
    };
  };

  it('reloads the visible tab right away, once per build', () => {
    const once = reloadOnce();
    const { page, prompts } = fakePage({ hidden: false, offline: false });

    recoverFromFailedLoad(page, once, 'build-a');
    expect(page.reload).toHaveBeenCalledOnce();
    expect(prompts).toHaveLength(0);

    // The reload landed on the same build again, for example from a stale
    // cache: offer the reload instead of looping.
    recoverFromFailedLoad(page, once, 'build-a');
    expect(page.reload).toHaveBeenCalledOnce();
    expect(prompts).toHaveLength(1);

    resetReloadForNewerBuildForTests();
    recoverFromFailedLoad(page, once, 'build-b');
    expect(page.reload).toHaveBeenCalledTimes(2);
  });

  it('only offers the reload while offline, holding work, or writing text', () => {
    const offline = fakePage({ hidden: false, offline: true });
    const once = reloadOnce();
    recoverFromFailedLoad(offline.page, once, 'build-a');
    expect(offline.page.reload).not.toHaveBeenCalled();
    expect(offline.prompts).toHaveLength(1);

    resetReloadForNewerBuildForTests();
    const release = holdAutomaticReload();
    const held = fakePage({ hidden: false, offline: false });
    recoverFromFailedLoad(held.page, once, 'build-a');
    expect(held.page.reload).not.toHaveBeenCalled();
    release();

    resetReloadForNewerBuildForTests();
    const writing = fakePage({
      hidden: false,
      offline: false,
      editingText: true,
    });
    recoverFromFailedLoad(writing.page, once, 'build-a');
    expect(writing.page.reload).not.toHaveBeenCalled();

    // None of those spent the one automatic reload.
    expect(once.claimed.size).toBe(0);
  });

  it('remembers the reload in session storage and never reloads without it', () => {
    const first = fakePage({ hidden: false, offline: false });
    recoverFromFailedLoad(first.page, undefined, 'build-a');
    expect(first.page.reload).toHaveBeenCalledOnce();

    resetReloadForNewerBuildForTests();
    const again = fakePage({ hidden: false, offline: false });
    recoverFromFailedLoad(again.page, undefined, 'build-a');
    expect(again.page.reload).not.toHaveBeenCalled();
    expect(again.prompts).toHaveLength(1);

    resetReloadForNewerBuildForTests();
    const unavailable = vi
      .spyOn(Storage.prototype, 'getItem')
      .mockImplementation(() => {
        throw new DOMException('denied', 'SecurityError');
      });
    try {
      const noStorage = fakePage({ hidden: false, offline: false });
      recoverFromFailedLoad(noStorage.page, undefined, 'build-b');
      expect(noStorage.page.reload).not.toHaveBeenCalled();
      expect(noStorage.prompts).toHaveLength(1);
    } finally {
      unavailable.mockRestore();
    }
  });
});
