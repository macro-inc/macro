import 'fake-indexeddb/auto';
import type { MagicChipDecoratorProps } from '@macro-inc/lexical-core';
import type {
  FoldedMessage,
  SessionMetadata,
} from '@service-agent-fold/generated/types';
import { QueryClient, QueryClientProvider } from '@tanstack/solid-query';
import { createComponent, createRoot } from 'solid-js';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  clearResolvedMagicChipMemory,
  flushResolvedMagicChips,
  resetResolvedMagicChips,
} from './resolved-cache';

const live = vi.hoisted(() => ({
  acquire: vi.fn(),
  load: vi.fn(),
  release: vi.fn(),
  issue: vi.fn(),
  snapshot: {
    messages: [] as unknown[],
    metadata: {} as unknown,
  },
  listeners: new Set<(events: unknown[]) => void>(),
}));

vi.mock('@core/agent-session/AgentSession', () => ({
  AgentSession: {
    acquire: (id: string) => {
      live.acquire(id);
      return {
        id,
        load: live.load,
        snapshot: () => Promise.resolve(live.snapshot),
        subscribe: (listener: (events: unknown[]) => void) => {
          live.listeners.add(listener);
          return () => live.listeners.delete(listener);
        },
        release: live.release,
      };
    },
  },
}));
vi.mock('@service-agent-harness/client', () => ({
  agentHarnessServiceClient: {
    get: vi.fn(async () => ({
      isOk: () => true,
      isErr: () => false,
      value: {
        status: { kind: 'disconnected' },
        ownerId: 'macro|alice@macro.com',
        canEdit: true,
      },
    })),
  },
}));
vi.mock('@core/component/Toast/Toast', () => ({
  toast: { failure: vi.fn(), success: vi.fn() },
}));

import { createMagicChipModel } from './create-magic-chip-model';

const prompt: FoldedMessage = {
  requestId: null,
  agentSessionId: 'session',
  turn: 0,
  author: { kind: 'user', userId: 'macro|wolf@macro.com' },
  parts: [{ kind: 'text', text: 'Say hi' }],
  stop: null,
  pending: false,
};

const response: FoldedMessage = {
  requestId: null,
  agentSessionId: 'session',
  turn: 0,
  author: { kind: 'agent' },
  parts: [{ kind: 'text', text: 'Hi!' }],
  stop: { kind: 'end_turn' },
  pending: false,
};

const props = {
  agentSessionId: 'session',
  promptedMessage: { turn: 0, author: 'user' },
  status: 'acp_ready',
} as MagicChipDecoratorProps;

const queryClient = new QueryClient({
  defaultOptions: { queries: { retry: false } },
});

function createModel() {
  let model!: ReturnType<typeof createMagicChipModel>;
  createComponent(QueryClientProvider, {
    client: queryClient,
    get children() {
      model = createMagicChipModel(props);
      return null;
    },
  });
  return model;
}

const settle = async () => {
  await new Promise((resolve) => setTimeout(resolve, 20));
};

describe('createMagicChipModel resolved cache', () => {
  beforeEach(async () => {
    await resetResolvedMagicChips();
    queryClient.clear();
    vi.clearAllMocks();
    live.listeners.clear();
    live.snapshot = {
      messages: [prompt, response],
      metadata: { pendingInteractions: [] } as SessionMetadata,
    };
    live.load.mockResolvedValue({ session: {}, bot: {} });
  });

  it('does not fold a turn IndexedDB already resolved', async () => {
    const first = createRoot((dispose) => {
      createModel();
      return dispose;
    });
    await vi.waitFor(() => expect(live.acquire).toHaveBeenCalledOnce());
    await settle();
    first();
    await flushResolvedMagicChips();
    clearResolvedMagicChipMemory();
    live.acquire.mockClear();
    live.load.mockClear();
    live.release.mockClear();

    let model!: ReturnType<typeof createMagicChipModel>;
    const second = createRoot((dispose) => {
      model = createModel();
      return dispose;
    });
    await vi.waitFor(() => expect(model.loading()).toBe(false));
    expect(model.presentation()).toEqual({ kind: 'settled', markdown: 'Hi!' });
    expect(live.acquire).not.toHaveBeenCalled();
    expect(live.load).not.toHaveBeenCalled();
    second();
    expect(live.release).not.toHaveBeenCalled();
  });

  it('does not start a fold after the chip unmounts during the cache read', async () => {
    const dispose = createRoot((rootDispose) => {
      createModel();
      return rootDispose;
    });
    dispose();
    await settle();
    expect(live.acquire).not.toHaveBeenCalled();
  });

  it('folds when IndexedDB has no resolved passage', async () => {
    const dispose = createRoot((rootDispose) => {
      createModel();
      return rootDispose;
    });
    await vi.waitFor(() => expect(live.acquire).toHaveBeenCalledOnce());
    dispose();
  });
});
