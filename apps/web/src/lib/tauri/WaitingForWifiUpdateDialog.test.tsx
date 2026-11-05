import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from '@solidjs/testing-library';
import { invoke } from '@tauri-apps/api/core';
import { createSignal } from 'solid-js';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { BundleUpdateStatus } from './TauriProvider';
import {
  createWaitingForWifiPrompt,
  nextWaitingForWifiPromptPhase,
  WaitingForWifiUpdateDialog,
} from './WaitingForWifiUpdateDialog';

vi.mock('@tauri-apps/api/core', () => ({ invoke: vi.fn() }));
vi.mock('@macro-inc/observability', () => ({
  Telemetry: { error: vi.fn() },
}));
// The phone drawer never finishes its transitions in jsdom; the desktop
// dialog marks itself closed, so closing is observable.
vi.mock('@core/mobile/isMobile', () => ({ isMobile: () => false }));
vi.mock('@core/mobile/virtualKeyboard', () => ({
  virtualKeyboardVisible: () => false,
}));
vi.mock('@ui', async () => ({
  ...(await import('@app/components/ui/components/Button')),
  ...(await import('@app/components/ui/components/Dialog')),
  ...(await import('@app/components/ui/components/Surface')),
}));

const WAITING: BundleUpdateStatus = { status: 'WaitingForWifi' };

beforeEach(() => {
  vi.stubGlobal('scrollTo', vi.fn());
  vi.stubGlobal(
    'ResizeObserver',
    class {
      observe() {}
      unobserve() {}
      disconnect() {}
    }
  );
  vi.mocked(invoke).mockResolvedValue(undefined);
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.mocked(invoke).mockReset();
});

describe('nextWaitingForWifiPromptPhase', () => {
  it('offers only the first Wi-Fi wait', () => {
    expect(nextWaitingForWifiPromptPhase('closed', WAITING, false)).toBe(
      'offer'
    );
    expect(nextWaitingForWifiPromptPhase('closed', WAITING, true)).toBe(
      'closed'
    );
  });

  it('withdraws the offer when the download starts on its own', () => {
    expect(
      nextWaitingForWifiPromptPhase(
        'offer',
        { status: 'Downloading', data: { progress: 0 } },
        true
      )
    ).toBe('closed');
  });

  it('follows an approved download through a restarted check', () => {
    for (const status of [
      { status: 'Idle' },
      { status: 'CheckingForUpdate' },
      { status: 'Unzipping', data: { progress: 50 } },
    ] satisfies BundleUpdateStatus[]) {
      expect(nextWaitingForWifiPromptPhase('downloading', status, true)).toBe(
        'downloading'
      );
    }
    expect(
      nextWaitingForWifiPromptPhase(
        'downloading',
        { status: 'Completed' },
        true
      )
    ).toBe('ready');
    expect(
      nextWaitingForWifiPromptPhase(
        'downloading',
        { status: 'Error', data: { message: 'offline' } },
        true
      )
    ).toBe('failed');
  });

  it('follows a download that starts after a refused grant', () => {
    expect(
      nextWaitingForWifiPromptPhase(
        'failed',
        { status: 'Downloading', data: { progress: 5 } },
        true
      )
    ).toBe('downloading');
    expect(nextWaitingForWifiPromptPhase('failed', WAITING, true)).toBe(
      'failed'
    );
  });
});

/** A dialog stays mounted while it animates out; Kobalte marks it closed. */
function promptOpen() {
  const dialog = screen.queryByRole('dialog');
  return dialog !== null && !dialog.hasAttribute('data-closed');
}

function renderPrompt() {
  const [status, setStatus] = createSignal<BundleUpdateStatus>({
    status: 'Idle',
  });
  let report: (next: BundleUpdateStatus) => void = () => {};
  render(() => {
    const prompt = createWaitingForWifiPrompt(status);
    report = (next) => {
      setStatus(next);
      prompt.observe(next);
    };
    return <WaitingForWifiUpdateDialog prompt={prompt} status={status()} />;
  });
  return (next: BundleUpdateStatus) => report(next);
}

it('downloads off Wi-Fi and restarts into the update', async () => {
  const report = renderPrompt();
  report(WAITING);

  await fireEvent.click(
    await screen.findByRole('button', { name: 'Download' })
  );
  expect(invoke).toHaveBeenCalledWith('grant_bundle_update', {
    approved: true,
  });

  report({ status: 'Downloading', data: { progress: 42.4 } });
  expect(await screen.findByText('Downloading… 42%')).toBeTruthy();

  report({ status: 'Completed' });
  await fireEvent.click(await screen.findByRole('button', { name: 'Restart' }));
  expect(invoke).toHaveBeenCalledWith('perform_update');
  await waitFor(() => expect(promptOpen()).toBe(false));
});

it('leaves the Wi-Fi wait running and does not ask again', async () => {
  const report = renderPrompt();
  report(WAITING);

  await fireEvent.click(await screen.findByRole('button', { name: 'Not now' }));
  await waitFor(() => expect(promptOpen()).toBe(false));

  report({ status: 'Idle' });
  report(WAITING);
  expect(promptOpen()).toBe(false);
  expect(invoke).not.toHaveBeenCalled();
});

it('reports a grant the updater refused while still waiting', async () => {
  vi.mocked(invoke).mockRejectedValue('No pending bundle update to approve');
  const report = renderPrompt();
  report(WAITING);

  await fireEvent.click(
    await screen.findByRole('button', { name: 'Download' })
  );
  expect(await screen.findByText("Couldn't download the update")).toBeTruthy();
});
