/**
 * @vitest-environment jsdom
 */

import { queryClient } from '@queries/client';
import { agentHarnessServiceClient } from '@service-agent-harness/client';
import { fireEvent, render, screen, waitFor } from '@solidjs/testing-library';
import { QueryClientProvider } from '@tanstack/solid-query';
import { err, ok } from 'neverthrow';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { TaskTrackingSetting } from './task-tracking-setting';

vi.mock('@service-agent-harness/client', () => ({
  agentHarnessServiceClient: {
    getTaskTracking: vi.fn(),
    setTaskTracking: vi.fn(),
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
      <TaskTrackingSetting />
    </QueryClientProvider>
  ));
}

describe('TaskTrackingSetting', () => {
  it('saves the toggled value', async () => {
    vi.mocked(agentHarnessServiceClient.getTaskTracking).mockResolvedValue(
      ok({ enabled: false })
    );
    vi.mocked(agentHarnessServiceClient.setTaskTracking).mockResolvedValue(
      ok({ enabled: true })
    );
    renderSetting();

    const toggle = await screen.findByRole('switch', {
      name: 'Track coding sessions with tasks',
    });
    await waitFor(() => expect(toggle).toHaveProperty('disabled', false));
    expect(toggle).toHaveProperty('checked', false);

    vi.mocked(agentHarnessServiceClient.getTaskTracking).mockResolvedValue(
      ok({ enabled: true })
    );
    fireEvent.click(toggle);

    await waitFor(() => expect(toggle).toHaveProperty('checked', true));
    expect(agentHarnessServiceClient.setTaskTracking).toHaveBeenCalledWith(
      true
    );
    expect(toastFailure).not.toHaveBeenCalled();
  });

  it('rolls back and reports a failed save', async () => {
    vi.mocked(agentHarnessServiceClient.getTaskTracking).mockResolvedValue(
      ok({ enabled: false })
    );
    vi.mocked(agentHarnessServiceClient.setTaskTracking).mockResolvedValue(
      err([{ code: 'HTTP_ERROR', message: 'boom' }])
    );
    renderSetting();

    const toggle = await screen.findByRole('switch', {
      name: 'Track coding sessions with tasks',
    });
    await waitFor(() => expect(toggle).toHaveProperty('disabled', false));
    fireEvent.click(toggle);

    await waitFor(() =>
      expect(toastFailure).toHaveBeenCalledWith(
        'Could not update task tracking'
      )
    );
    expect(toggle).toHaveProperty('checked', false);
  });
});
