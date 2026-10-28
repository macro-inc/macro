/**
 * @vitest-environment jsdom
 */

import { queryClient } from '@queries/client';
import { agentHarnessServiceClient } from '@service-agent-harness/client';
import { fireEvent, render, screen, waitFor } from '@solidjs/testing-library';
import { QueryClientProvider } from '@tanstack/solid-query';
import { err, ok } from 'neverthrow';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { CodingPreferencesSetting } from './coding-preferences-setting';

vi.mock('@service-agent-harness/client', () => ({
  agentHarnessServiceClient: {
    getCodingPreferences: vi.fn(),
    setCodingPreferences: vi.fn(),
  },
}));

const toastFailure = vi.hoisted(() => vi.fn());
vi.mock('@core/component/Toast/Toast', () => ({
  toast: { success: vi.fn(), failure: toastFailure },
}));

afterEach(() => {
  vi.clearAllMocks();
  queryClient.clear();
});

function renderSetting() {
  render(() => (
    <QueryClientProvider client={queryClient}>
      <CodingPreferencesSetting />
    </QueryClientProvider>
  ));
}

/** The switch's accessible input is sr-only; users click the control drawn beside it. */
function visibleControl(toggle: HTMLElement): HTMLElement {
  const control = toggle.nextElementSibling;
  if (!(control instanceof HTMLElement)) {
    throw new Error('the switch has no visible control');
  }
  return control;
}

describe('CodingPreferencesSetting', () => {
  it('saves one toggled preference alongside the other', async () => {
    vi.mocked(agentHarnessServiceClient.getCodingPreferences).mockResolvedValue(
      ok({ createTasks: false, openPullRequests: true })
    );
    vi.mocked(agentHarnessServiceClient.setCodingPreferences).mockResolvedValue(
      ok({ createTasks: true, openPullRequests: true })
    );
    renderSetting();

    const createTasks = await screen.findByRole('switch', {
      name: 'Create tasks',
    });
    const openPullRequests = screen.getByRole('switch', {
      name: 'Open pull requests',
    });
    await waitFor(() => expect(createTasks).toHaveProperty('disabled', false));
    expect(createTasks).toHaveProperty('checked', false);
    expect(openPullRequests).toHaveProperty('checked', true);

    vi.mocked(agentHarnessServiceClient.getCodingPreferences).mockResolvedValue(
      ok({ createTasks: true, openPullRequests: true })
    );
    fireEvent.click(visibleControl(createTasks));

    await waitFor(() => expect(createTasks).toHaveProperty('checked', true));
    expect(openPullRequests).toHaveProperty('checked', true);
    expect(agentHarnessServiceClient.setCodingPreferences).toHaveBeenCalledWith(
      { createTasks: true, openPullRequests: true }
    );
    expect(toastFailure).not.toHaveBeenCalled();
  });

  it('rolls back and reports a failed save', async () => {
    vi.mocked(agentHarnessServiceClient.getCodingPreferences).mockResolvedValue(
      ok({ createTasks: false, openPullRequests: false })
    );
    vi.mocked(agentHarnessServiceClient.setCodingPreferences).mockResolvedValue(
      err([{ code: 'HTTP_ERROR', message: 'boom' }])
    );
    renderSetting();

    const openPullRequests = await screen.findByRole('switch', {
      name: 'Open pull requests',
    });
    await waitFor(() =>
      expect(openPullRequests).toHaveProperty('disabled', false)
    );
    fireEvent.click(visibleControl(openPullRequests));

    await waitFor(() =>
      expect(toastFailure).toHaveBeenCalledWith(
        'Could not update coding preferences'
      )
    );
    expect(openPullRequests).toHaveProperty('checked', false);
  });

  it('disables both switches when the preferences fail to load', async () => {
    vi.mocked(agentHarnessServiceClient.getCodingPreferences).mockResolvedValue(
      err([{ code: 'HTTP_ERROR', message: 'boom' }])
    );
    renderSetting();

    const createTasks = await screen.findByRole('switch', {
      name: 'Create tasks',
    });
    await waitFor(() =>
      expect(agentHarnessServiceClient.getCodingPreferences).toHaveBeenCalled()
    );
    expect(createTasks).toHaveProperty('disabled', true);
    expect(
      screen.getByRole('switch', { name: 'Open pull requests' })
    ).toHaveProperty('disabled', true);
  });
});
