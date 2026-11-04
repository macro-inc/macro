import { beforeEach, describe, expect, it, vi } from 'vitest';

const native = vi.hoisted(() => ({
  invoke: vi.fn(),
  mobilePlatform: vi.fn(),
}));

vi.mock('@core/component/Toast/Toast', () => ({
  toast: { custom: vi.fn() },
}));
vi.mock('@core/mobile/isTouchDevice', () => ({ isTouchDevice: () => false }));
vi.mock('@tauri-apps/api/core', () => ({ invoke: native.invoke }));
vi.mock('./platform', async (importOriginal) => ({
  ...(await importOriginal<typeof import('./platform')>()),
  getNativeMobilePlatform: native.mobilePlatform,
}));

import {
  hasAutomaticReloadHolds,
  holdAutomaticReload,
  pendingWebUpdate,
  promptReloadForFailedLoad,
  type ReloadOnce,
  type ReloadPage,
  recoverFromFailedLoad,
  reloadForNewerBuild,
  resetReloadForNewerBuildForTests,
  syncNativeReloadHold,
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

const settled = () => new Promise((resolve) => setTimeout(resolve));

describe('holdAutomaticReload', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    resetReloadForNewerBuildForTests();
  });

  it('tells the mobile updater until the last hold is released', async () => {
    native.mobilePlatform.mockReturnValue('ios');
    native.invoke.mockResolvedValue(undefined);

    const first = holdAutomaticReload();
    const second = holdAutomaticReload();
    first();
    await vi.waitFor(() => expect(native.invoke).toHaveBeenCalledOnce());
    await settled();
    expect(native.invoke).toHaveBeenCalledOnce();

    second();
    await vi.waitFor(() => expect(native.invoke).toHaveBeenCalledTimes(2));
    expect(native.invoke.mock.calls).toEqual([
      ['set_bundle_reload_hold', { held: true }],
      ['set_bundle_reload_hold', { held: false }],
    ]);
  });

  it('sends one write at a time and finishes on the latest state', async () => {
    native.mobilePlatform.mockReturnValue('ios');
    let finishWrite = () => {};
    native.invoke.mockImplementationOnce(
      () =>
        new Promise<void>((resolve) => {
          finishWrite = resolve;
        })
    );
    native.invoke.mockResolvedValue(undefined);

    const release = holdAutomaticReload();
    release();
    await settled();
    expect(native.invoke).toHaveBeenCalledOnce();

    finishWrite();
    await vi.waitFor(() => expect(native.invoke).toHaveBeenCalledTimes(2));
    expect(native.invoke.mock.calls).toEqual([
      ['set_bundle_reload_hold', { held: true }],
      ['set_bundle_reload_hold', { held: false }],
    ]);
  });

  it('can write again after a failed write', async () => {
    native.mobilePlatform.mockReturnValue('ios');
    native.invoke.mockRejectedValueOnce(new Error('bridge unavailable'));
    native.invoke.mockResolvedValue(undefined);

    await expect(syncNativeReloadHold()).rejects.toThrow('bridge unavailable');
    await expect(syncNativeReloadHold()).resolves.toBeUndefined();

    expect(native.invoke).toHaveBeenCalledTimes(2);
  });

  it('clears a hold left behind when a new document has none', async () => {
    native.mobilePlatform.mockReturnValue('android');
    native.invoke.mockResolvedValue(undefined);

    await syncNativeReloadHold();

    expect(native.invoke.mock.calls).toEqual([
      ['set_bundle_reload_hold', { held: false }],
    ]);
  });

  it('keeps a hold taken before the document finished mounting', async () => {
    native.mobilePlatform.mockReturnValue('ios');
    native.invoke.mockResolvedValue(undefined);
    holdAutomaticReload();
    await settled();
    native.invoke.mockClear();

    await syncNativeReloadHold();

    expect(native.invoke.mock.calls).toEqual([
      ['set_bundle_reload_hold', { held: true }],
    ]);
  });

  it('stays off the native bridge outside the mobile apps', async () => {
    native.mobilePlatform.mockReturnValue(undefined);

    holdAutomaticReload()();
    await syncNativeReloadHold();

    expect(native.invoke).not.toHaveBeenCalled();
    expect(hasAutomaticReloadHolds()).toBe(false);
  });
});

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
    expect(page.reload).toHaveBeenCalledExactlyOnceWith('failed_load_recovery');
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

  it('reloads a hidden tab by itself at most once per build', () => {
    const once = reloadOnce();
    const first = fakePage({ hidden: true, offline: false });
    recoverFromFailedLoad(first.page, once, 'build-a');
    expect(first.page.reload).toHaveBeenCalledExactlyOnceWith(
      'failed_load_recovery'
    );

    // The reload landed on the same build, still hidden: offer the reload
    // without reloading again, now or when the tab is hidden later.
    resetReloadForNewerBuildForTests();
    const again = fakePage({ hidden: true, offline: false });
    recoverFromFailedLoad(again.page, once, 'build-a');
    again.hide();
    expect(again.page.reload).not.toHaveBeenCalled();
    expect(again.prompts).toHaveLength(1);
  });

  it('spends the allowance when an offered reload runs by itself later', () => {
    const once = reloadOnce();
    const offline = fakePage({ hidden: true, offline: true });
    recoverFromFailedLoad(offline.page, once, 'build-a');
    expect(offline.page.reload).not.toHaveBeenCalled();

    offline.goOnline();
    expect(offline.page.reload).toHaveBeenCalledExactlyOnceWith(
      'cache_replaced_automatic'
    );
    expect(once.claimed).toEqual(new Set(['build-a']));
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

    // Another build reloaded since: build-a still never reloads again, so two
    // stale builds served in turn cannot reload each other.
    resetReloadForNewerBuildForTests();
    const next = fakePage({ hidden: false, offline: false });
    recoverFromFailedLoad(next.page, undefined, 'build-c');
    expect(next.page.reload).toHaveBeenCalledOnce();
    resetReloadForNewerBuildForTests();
    const back = fakePage({ hidden: false, offline: false });
    recoverFromFailedLoad(back.page, undefined, 'build-a');
    expect(back.page.reload).not.toHaveBeenCalled();

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
