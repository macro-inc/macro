import { beforeEach, describe, expect, it, vi } from 'vitest';

const native = vi.hoisted(() => ({
  invoke: vi.fn(),
  isTauri: vi.fn(),
}));

vi.mock('@core/component/Toast/Toast', () => ({
  toast: { custom: vi.fn() },
}));
vi.mock('@core/mobile/isTouchDevice', () => ({ isTouchDevice: () => false }));
vi.mock('@tauri-apps/api/core', () => ({ invoke: native.invoke }));
vi.mock('./platform', async (importOriginal) => ({
  ...(await importOriginal<typeof import('./platform')>()),
  isTauri: native.isTauri,
}));

import { Telemetry } from '@macro-inc/observability';

import {
  hasAutomaticReloadHolds,
  holdAutomaticReload,
  pendingWebUpdate,
  promptReloadForFailedLoad,
  type ReloadPage,
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

describe('holdAutomaticReload', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    resetReloadForNewerBuildForTests();
  });

  it('tells the native updater until the last hold is released', async () => {
    native.isTauri.mockReturnValue(true);
    native.invoke.mockResolvedValue(undefined);

    const first = holdAutomaticReload();
    const second = holdAutomaticReload();
    first();
    second();

    await vi.waitFor(() => expect(native.invoke).toHaveBeenCalledTimes(4));
    expect(native.invoke.mock.calls).toEqual([
      ['set_bundle_reload_hold', { held: true }],
      ['set_bundle_reload_hold', { held: true }],
      ['set_bundle_reload_hold', { held: true }],
      ['set_bundle_reload_hold', { held: false }],
    ]);
  });

  it('keeps working on binaries that do not have the command', async () => {
    native.isTauri.mockReturnValue(true);
    native.invoke.mockRejectedValue(new Error('Command not found'));
    const reported = vi.spyOn(Telemetry, 'error');

    const release = holdAutomaticReload();
    expect(hasAutomaticReloadHolds()).toBe(true);
    release();

    await vi.waitFor(() => expect(native.invoke).toHaveBeenCalledTimes(2));
    await new Promise((resolve) => setTimeout(resolve));
    expect(hasAutomaticReloadHolds()).toBe(false);
    expect(reported).not.toHaveBeenCalled();
  });

  it('stays off the native bridge on the web', () => {
    native.isTauri.mockReturnValue(false);

    holdAutomaticReload()();

    expect(native.invoke).not.toHaveBeenCalled();
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
