import type { MacrodStatus } from '@macro/tauri/macrod';
import { fireEvent, render, screen } from '@solidjs/testing-library';
import { describe, expect, it, vi } from 'vitest';
import type {
  NewLocalAgent,
  ReadyAgent,
  SetupCapabilities,
} from '../core/setup';
import { LocalRuntimeSetupPanel } from './local-runtime-setup-panel';

const RUNNING: MacrodStatus = {
  phase: 'running',
  agentId: 'claude-code',
  agentName: 'Claude Code',
  workspace: '/home/me/Macro',
  pairingCode: null,
  pairingExpiresAt: null,
  harnessId: 'harness-1',
  lastError: null,
};

function capabilities(
  overrides: Partial<SetupCapabilities> = {}
): SetupCapabilities {
  return {
    detectAgents: async () => [
      {
        id: 'claude-code',
        name: 'Claude Code',
        note: null,
        needs_install: false,
      },
    ],
    startDaemon: async () => RUNNING,
    waitForRunning: async () => RUNNING,
    allowPermissionBypass: async () => {},
    listAgents: async () => [],
    loadModels: async () => ({
      status: 'available',
      models: [{ id: 'sonnet', name: 'Sonnet' }],
    }),
    createAgent: async (agent: NewLocalAgent) => ({
      botId: 'bot-1',
      name: agent.name,
      handle: agent.handle,
    }),
    sleep: async () => {},
    ...overrides,
  };
}

describe('LocalRuntimeSetupPanel', () => {
  it('sets up the agent it found and opens a session with it', async () => {
    const onClose = vi.fn();
    const onOpenSession = vi.fn((_agent: ReadyAgent) => {});
    render(() => (
      <LocalRuntimeSetupPanel
        capabilities={capabilities()}
        onOpenSession={onOpenSession}
        defaultWorkspace="/home/me/Macro"
        onClose={onClose}
      />
    ));

    expect(
      await screen.findByText('Found Claude Code on this computer.')
    ).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Set up Claude Code' }));

    expect(await screen.findByText('@claude-code is ready')).toBeTruthy();
    expect(screen.getByText('Sessions run in /home/me/Macro.')).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: 'Start a session' }));
    expect(onOpenSession).toHaveBeenCalledWith({
      botId: 'bot-1',
      name: 'Claude Code',
      handle: 'claude-code',
    });
    expect(onClose).toHaveBeenCalledOnce();
  });

  it('shows the failed step and recovers on Try again', async () => {
    let attempts = 0;
    const caps = capabilities({
      waitForRunning: async () => {
        attempts++;
        if (attempts === 1) throw new Error('the pairing code expired');
        return RUNNING;
      },
    });
    render(() => (
      <LocalRuntimeSetupPanel
        capabilities={caps}
        onOpenSession={() => {}}
        autoStart
      />
    ));

    expect(await screen.findByText('the pairing code expired')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Try again' }));
    expect(await screen.findByText('@claude-code is ready')).toBeTruthy();
  });

  it('asks to install an agent when none is found', async () => {
    render(() => (
      <LocalRuntimeSetupPanel
        capabilities={capabilities({ detectAgents: async () => [] })}
        onOpenSession={() => {}}
        autoStart
      />
    ));

    expect(
      await screen.findByRole('button', { name: 'Scan again' })
    ).toBeTruthy();
    expect(screen.queryByRole('button', { name: /^Set up/ })).toBeNull();
  });
});
