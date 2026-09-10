/**
 * @vitest-environment jsdom
 *
 * The controller against a mocked harness client: an answer is one POST on
 * the agent's request id, only the owner may send it, a 409 is said once,
 * and the owner is named for everyone else.
 */

import type { PendingElicitation } from '@service-agent-fold/generated/types';
import { createRoot, createSignal } from 'solid-js';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createElicitationController } from './create-elicitation-controller';

const control = vi.hoisted(() => ({
  calls: [] as { sessionId: string; action: unknown }[],
  outcome: 'ok' as 'ok' | 'conflict' | 'err' | 'reject',
}));

vi.mock('@service-agent-harness/client', () => ({
  agentHarnessServiceClient: {
    control: vi.fn(async (sessionId: string, action: unknown) => {
      control.calls.push({ sessionId, action });
      if (control.outcome === 'reject') throw new Error('network');
      return {
        isErr: () => control.outcome !== 'ok',
        error:
          control.outcome === 'conflict'
            ? [{ code: 'CONFLICT' }]
            : [{ code: 'INTERNAL' }],
        value: { actionId: 'unused', status: 'sent' },
      };
    }),
  },
}));

const toast = vi.hoisted(() => ({ failure: vi.fn(), success: vi.fn() }));
vi.mock('@core/component/Toast/Toast', () => ({ toast }));

vi.mock('@core/user', () => ({
  tryMacroId: (id: string) => (id.startsWith('macro|') ? id : undefined),
  getDisplayName: (id: string) =>
    id === 'macro|alice@macro.com' ? 'Alice Owner' : '',
}));

const question: PendingElicitation = {
  requestId: 43,
  turn: 0,
  toolCall: null,
  message: 'Which colour?',
  request: {
    kind: 'form',
    schema: { title: null, description: null, properties: [], required: [] },
  },
};

function setup(options?: { ownerId?: string; viewerId?: string }) {
  const [pending, setPending] = createSignal<PendingElicitation | undefined>(
    question
  );
  const [ownerId] = createSignal<string | undefined>(
    'ownerId' in (options ?? {}) ? options?.ownerId : 'macro|alice@macro.com'
  );
  const [viewerId] = createSignal<string | undefined>(
    'viewerId' in (options ?? {}) ? options?.viewerId : 'macro|alice@macro.com'
  );
  const { controller, dispose } = createRoot((dispose) => ({
    controller: createElicitationController({
      sessionId: () => 'session-1',
      pending,
      ownerId,
      viewerId,
    }),
    dispose,
  }));
  return { controller, setPending, dispose };
}

beforeEach(() => {
  control.calls = [];
  control.outcome = 'ok';
  toast.failure.mockReset();
});

describe('createElicitationController', () => {
  it('answers on the agent request id with the action spread into the body', async () => {
    const { controller, dispose } = setup();
    expect(controller.canAnswer()).toBe(true);
    const accepted = await controller.respond({
      action: 'accept',
      content: { colour: 'teal' },
    });
    expect(accepted).toBe(true);
    expect(control.calls).toEqual([
      {
        sessionId: 'session-1',
        action: {
          type: 'respondElicitation',
          requestId: 43,
          action: 'accept',
          content: { colour: 'teal' },
        },
      },
    ]);
    dispose();
  });

  it('a viewer who is not the owner cannot answer, and knows who can', async () => {
    const { controller, dispose } = setup({ viewerId: 'macro|bob@macro.com' });
    expect(controller.canAnswer()).toBe(false);
    expect(controller.ownerName()).toBe('Alice Owner');
    const sent = await controller.respond({ action: 'decline' });
    expect(sent).toBe(false);
    expect(control.calls).toEqual([]);
    dispose();
  });

  it('nobody can answer before the session has loaded', () => {
    const { controller, dispose } = setup({ ownerId: undefined });
    expect(controller.canAnswer()).toBe(false);
    expect(controller.ownerName()).toBe('the session owner');
    dispose();
  });

  it('a 409 means the agent moved on: said once, nothing else', async () => {
    control.outcome = 'conflict';
    const { controller, dispose } = setup();
    expect(await controller.respond({ action: 'cancel' })).toBe(false);
    expect(toast.failure).toHaveBeenCalledWith(
      'The agent is no longer waiting on that question'
    );
    dispose();
  });

  it('other failures and thrown errors read as a failed send', async () => {
    control.outcome = 'err';
    const { controller, dispose } = setup();
    expect(await controller.respond({ action: 'decline' })).toBe(false);
    control.outcome = 'reject';
    expect(await controller.respond({ action: 'decline' })).toBe(false);
    expect(toast.failure).toHaveBeenCalledTimes(2);
    expect(toast.failure).toHaveBeenCalledWith("Couldn't send your answer");
    dispose();
  });

  it('nothing is sent once the question is gone', async () => {
    const { controller, setPending, dispose } = setup();
    setPending(undefined);
    expect(await controller.respond({ action: 'decline' })).toBe(false);
    expect(control.calls).toEqual([]);
    dispose();
  });
});
