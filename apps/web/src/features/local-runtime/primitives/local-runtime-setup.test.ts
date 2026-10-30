import type { MacrodStatus } from '@macro/tauri/macrod';
import { createRoot } from 'solid-js';
import { describe, expect, it, vi } from 'vitest';
import type { NewLocalAgent, SetupCapabilities } from '../core/setup';
import { createLocalRuntimeSetup } from './local-runtime-setup';

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

function fakeCapabilities(
  overrides: Partial<SetupCapabilities> = {}
): SetupCapabilities {
  return {
    detectAgents: async () => [
      { id: 'codex', name: 'Codex', note: null, needs_install: false },
      {
        id: 'claude-code',
        name: 'Claude Code',
        note: null,
        needs_install: true,
      },
    ],
    startDaemon: async () => ({ ...RUNNING, phase: 'starting' }),
    waitForRunning: async (onPhase) => {
      onPhase('pairing');
      return RUNNING;
    },
    allowPermissionBypass: async () => {},
    listAgents: async () => [],
    loadModels: async () => ({
      status: 'available',
      currentModel: 'sonnet',
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

function withSetup(caps: SetupCapabilities) {
  return createRoot((dispose) => ({
    setup: createLocalRuntimeSetup(caps),
    dispose,
  }));
}

describe('createLocalRuntimeSetup', () => {
  it('starts the preferred agent and creates a Macro agent on its runtime', async () => {
    const startDaemon = vi.fn(async () => RUNNING);
    const allowPermissionBypass = vi.fn(async () => {});
    const createAgent = vi.fn(async (agent: NewLocalAgent) => ({
      botId: 'bot-1',
      name: agent.name,
      handle: agent.handle,
    }));
    const { setup, dispose } = withSetup(
      fakeCapabilities({ startDaemon, allowPermissionBypass, createAgent })
    );

    await setup.run({ workspace: ' /tmp/work ', fullAccess: true });

    expect(startDaemon).toHaveBeenCalledWith({
      agent: 'claude-code',
      workspace: '/tmp/work',
    });
    expect(allowPermissionBypass).toHaveBeenCalledWith('harness-1');
    expect(createAgent).toHaveBeenCalledWith({
      name: 'Claude Code',
      handle: 'claude-code',
      description: 'Runs Claude Code on this computer with your own login.',
      harnessId: 'harness-1',
      defaultModel: 'sonnet',
      autoAcceptPermissions: true,
    });
    expect(setup.state()).toEqual({
      kind: 'ready',
      agent: { botId: 'bot-1', name: 'Claude Code', handle: 'claude-code' },
      workspace: '/home/me/Macro',
    });
    dispose();
  });

  it('reuses an agent already bound to the runtime', async () => {
    const createAgent = vi.fn();
    const { setup, dispose } = withSetup(
      fakeCapabilities({
        createAgent,
        listAgents: async () => [
          {
            botId: 'bot-9',
            name: 'Mine',
            handle: 'mine',
            harnessId: 'harness-1',
          },
        ],
      })
    );

    await setup.run({ fullAccess: false });

    expect(createAgent).not.toHaveBeenCalled();
    expect(setup.state()).toMatchObject({
      kind: 'ready',
      agent: { botId: 'bot-9', handle: 'mine' },
    });
    dispose();
  });

  it('reports no agents without starting anything', async () => {
    const startDaemon = vi.fn();
    const { setup, dispose } = withSetup(
      fakeCapabilities({ detectAgents: async () => [], startDaemon })
    );

    await setup.run({ fullAccess: false });

    expect(setup.state()).toEqual({ kind: 'no-agents' });
    expect(startDaemon).not.toHaveBeenCalled();
    dispose();
  });

  it('fails the connect step with the daemon’s message', async () => {
    const { setup, dispose } = withSetup(
      fakeCapabilities({
        waitForRunning: async () => {
          throw new Error('the pairing code expired before it was approved');
        },
      })
    );

    await setup.run({ fullAccess: false });

    expect(setup.state()).toEqual({
      kind: 'failed',
      step: 'connect',
      message: 'the pairing code expired before it was approved',
    });
    dispose();
  });

  it('waits for the new runtime’s models, and resumes at the agent step on retry', async () => {
    let loads = 0;
    const startDaemon = vi.fn(async () => RUNNING);
    const createAgent = vi.fn(async (agent: NewLocalAgent) => ({
      botId: 'bot-1',
      name: agent.name,
      handle: agent.handle,
    }));
    const { setup, dispose } = withSetup(
      fakeCapabilities({
        startDaemon,
        createAgent,
        loadModels: async () => {
          loads++;
          if (loads < 3) throw new Error('runtime not connected');
          return { status: 'available', models: [{ id: 'm', name: 'M' }] };
        },
      })
    );

    await setup.run({ fullAccess: false });
    expect(setup.state().kind).toBe('ready');
    expect(loads).toBe(3);
    expect(createAgent).toHaveBeenCalledWith(
      expect.objectContaining({ defaultModel: 'm' })
    );

    // A failure after connecting retries without re-pairing.
    createAgent.mockRejectedValueOnce(new Error('handle rejected'));
    const second = withSetup(fakeCapabilities({ startDaemon, createAgent }));
    await second.setup.run({ fullAccess: false });
    expect(second.setup.state()).toMatchObject({
      kind: 'failed',
      step: 'agent',
      message: 'handle rejected',
    });
    await second.setup.run();
    expect(second.setup.state().kind).toBe('ready');
    expect(startDaemon).toHaveBeenCalledTimes(2);
    second.dispose();
    dispose();
  });

  it('finishes an already running daemon without starting it', async () => {
    const startDaemon = vi.fn();
    const { setup, dispose } = withSetup(fakeCapabilities({ startDaemon }));

    await setup.adopt(RUNNING, { fullAccess: false });

    expect(startDaemon).not.toHaveBeenCalled();
    expect(setup.state().kind).toBe('ready');
    dispose();
  });
});
