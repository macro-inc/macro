import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@core/component/Toast/Toast', () => ({
  toast: { custom: vi.fn() },
}));

import {
  holdAutomaticReload,
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
