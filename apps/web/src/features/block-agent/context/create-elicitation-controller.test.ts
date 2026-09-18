/**
 * @vitest-environment jsdom
 *
 * The controller against a stub `issue`: an answer is one action on the
 * session's optimistic path, only a viewer with edit access may send it, and
 * a 409 is said once.
 */

import type { IssueResult } from '@core/agent-session/AgentSession';
import type { PendingElicitation } from '@service-agent-fold/generated/types';
import type { AgentAction } from '@service-agent-harness/generated/schemas';
import { err, ok } from 'neverthrow';
import { createRoot, createSignal } from 'solid-js';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createElicitationController } from './create-elicitation-controller';

const issued = vi.hoisted(() => ({
  actions: [] as AgentAction[],
  outcome: 'ok' as 'ok' | 'conflict' | 'err' | 'reject' | 'no-session',
}));

const toast = vi.hoisted(() => ({ failure: vi.fn(), success: vi.fn() }));
vi.mock('@core/component/Toast/Toast', () => ({ toast }));

const issue = (action: AgentAction): Promise<IssueResult> | undefined => {
  issued.actions.push(action);
  if (issued.outcome === 'no-session') return undefined;
  if (issued.outcome === 'reject') return Promise.reject(new Error('network'));
  if (issued.outcome === 'ok') {
    return Promise.resolve(
      ok({ actionId: 'accepted', status: 'sent' }) as IssueResult
    );
  }
  return Promise.resolve(
    err([
      { code: issued.outcome === 'conflict' ? 'CONFLICT' : 'INTERNAL' },
    ]) as unknown as IssueResult
  );
};

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

function setup(options: { canEdit?: boolean } = { canEdit: true }) {
  const [pending, setPending] = createSignal<PendingElicitation | undefined>(
    question
  );
  const [canEdit] = createSignal<boolean | undefined>(options.canEdit);
  const { controller, dispose } = createRoot((dispose) => ({
    controller: createElicitationController({ pending, canEdit, issue }),
    dispose,
  }));
  return { controller, setPending, dispose };
}

beforeEach(() => {
  issued.actions = [];
  issued.outcome = 'ok';
  toast.failure.mockReset();
});

describe('createElicitationController', () => {
  it('answers through the session with the agent request id and the answer', async () => {
    const { controller, dispose } = setup();
    expect(controller.canAnswer()).toBe(true);
    const accepted = await controller.respond({
      action: 'accept',
      content: { colour: 'teal' },
    });
    expect(accepted).toBe(true);
    expect(issued.actions).toEqual([
      {
        type: 'respondElicitation',
        requestId: 43,
        action: 'accept',
        content: { colour: 'teal' },
      },
    ]);
    dispose();
  });

  it('a viewer without edit access cannot answer', async () => {
    const { controller, dispose } = setup({ canEdit: false });
    expect(controller.canAnswer()).toBe(false);
    const sent = await controller.respond({ action: 'decline' });
    expect(sent).toBe(false);
    expect(issued.actions).toEqual([]);
    dispose();
  });

  it('nobody can answer before the session has loaded', () => {
    const { controller, dispose } = setup({ canEdit: undefined });
    expect(controller.canAnswer()).toBe(false);
    dispose();
  });

  it('a 409 means the agent moved on: said once, nothing else', async () => {
    issued.outcome = 'conflict';
    const { controller, dispose } = setup();
    expect(await controller.respond({ action: 'cancel' })).toBe(false);
    expect(toast.failure).toHaveBeenCalledWith(
      'The agent is no longer waiting on that question'
    );
    dispose();
  });

  it('other failures and thrown errors read as a failed send', async () => {
    issued.outcome = 'err';
    const { controller, dispose } = setup();
    expect(await controller.respond({ action: 'decline' })).toBe(false);
    issued.outcome = 'reject';
    expect(await controller.respond({ action: 'decline' })).toBe(false);
    expect(toast.failure).toHaveBeenCalledTimes(2);
    expect(toast.failure).toHaveBeenCalledWith("Couldn't send your answer");
    dispose();
  });

  it('a block with no session to act on reports nothing sent', async () => {
    issued.outcome = 'no-session';
    const { controller, dispose } = setup();
    expect(await controller.respond({ action: 'decline' })).toBe(false);
    expect(toast.failure).not.toHaveBeenCalled();
    dispose();
  });

  it('nothing is sent once the question is gone', async () => {
    const { controller, setPending, dispose } = setup();
    setPending(undefined);
    expect(await controller.respond({ action: 'decline' })).toBe(false);
    expect(issued.actions).toEqual([]);
    dispose();
  });
});
