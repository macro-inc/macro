/** @vitest-environment jsdom */
import type { IssueResult } from '@core/agent-session/AgentSession';
import type { PendingInteraction } from '@service-agent-fold/generated/types';
import type { AgentAction } from '@service-agent-harness/generated/schemas';
import { err, ok } from 'neverthrow';
import { createRoot, createSignal } from 'solid-js';
import { describe, expect, it, vi } from 'vitest';
import type { InteractionResponse } from '../context/interaction';
import { createInteractionController } from './create-interaction-controller';

const permission = {
  kind: 'permission',
  requestId: 7,
  turn: 0,
  toolCall: 'tool',
  options: [{ id: 'once', name: 'Allow once', kind: 'allow_once' }],
} satisfies PendingInteraction;
const question = {
  kind: 'elicitation',
  requestId: '7',
  turn: 0,
  toolCall: null,
  message: 'Which colour?',
  request: {
    kind: 'form',
    schema: { title: null, description: null, properties: [], required: [] },
  },
} satisfies PendingInteraction;
const approval = {
  ...permission,
  answer: { kind: 'selected', optionId: 'once' },
} satisfies InteractionResponse;
const answer = {
  ...question,
  answer: { action: 'accept', content: { colour: 'teal' } },
} satisfies InteractionResponse;
const accepted: IssueResult = ok({ actionId: 'accepted', status: 'sent' });

function setup() {
  const [sessionId, setSessionId] = createSignal<string | undefined>(
    'session-a'
  );
  const [pending, setPending] = createSignal<PendingInteraction[]>([
    permission,
    question,
  ]);
  const [canEdit, setCanEdit] = createSignal<boolean | undefined>(true);
  const issue = vi.fn<
    (action: AgentAction) => Promise<IssueResult> | undefined
  >(() => Promise.resolve(accepted));
  const onFailure = vi.fn();
  const { controller, dispose } = createRoot((dispose) => ({
    controller: createInteractionController({
      sessionId,
      pending,
      canEdit,
      issue,
      onFailure,
    }),
    dispose,
  }));
  return {
    controller,
    dispose,
    issue,
    onFailure,
    setSessionId,
    setPending,
    setCanEdit,
  };
}

describe('interaction responses', () => {
  it('preserves each response type and numeric versus string request ids', async () => {
    const { controller, issue, dispose } = setup();
    expect(await controller.respond(approval)).toBe(true);
    expect(await controller.respond(answer)).toBe(true);
    expect(issue.mock.calls.map(([action]) => action)).toEqual([
      { type: 'respondToPermission', requestId: 7, answer: approval.answer },
      { type: 'respondElicitation', requestId: '7', ...answer.answer },
    ]);
    dispose();
  });

  it.each([approval, answer])(
    'deduplicates an in-flight $kind response',
    async (response) => {
      const { controller, issue, dispose } = setup();
      const first = controller.respond(response);
      expect(controller.answering(response)).toBe(true);
      expect(await controller.respond(response)).toBe(false);
      expect(issue).toHaveBeenCalledTimes(1);
      expect(await first).toBe(true);
      expect(controller.answering(response)).toBe(false);
      dispose();
    }
  );

  it.each([false, undefined])(
    'requires loaded edit access (%s)',
    async (canEdit) => {
      const { controller, issue, setCanEdit, dispose } = setup();
      setCanEdit(canEdit);
      expect(controller.canAnswer()).toBe(false);
      expect(await controller.respond(approval)).toBe(false);
      expect(await controller.respond(answer)).toBe(false);
      expect(issue).not.toHaveBeenCalled();
      dispose();
    }
  );

  it('rejects dead requests and ids reused by a later turn', async () => {
    const { controller, issue, setPending, dispose } = setup();
    setPending([
      { ...permission, turn: 1 },
      { ...question, turn: 1 },
    ]);
    expect(await controller.respond(approval)).toBe(false);
    expect(await controller.respond(answer)).toBe(false);
    setPending([]);
    expect(await controller.respond({ ...approval, turn: 1 })).toBe(false);
    expect(issue).not.toHaveBeenCalled();
    dispose();
  });

  it('does not confuse numeric ids with string ids of the same kind', async () => {
    const { controller, issue, setPending, dispose } = setup();
    setPending([{ ...permission, requestId: '7' }]);
    expect(await controller.respond(approval)).toBe(false);
    expect(await controller.respond({ ...approval, requestId: '7' })).toBe(
      true
    );
    expect(issue).toHaveBeenCalledTimes(1);
    dispose();
  });

  it('reports a stale response once and allows a retry after refusal', async () => {
    const { controller, issue, onFailure, dispose } = setup();
    issue.mockResolvedValueOnce(
      err([{ code: 'CONFLICT', message: 'answered' }])
    );
    expect(await controller.respond(approval)).toBe(false);
    expect(onFailure).toHaveBeenCalledExactlyOnceWith(
      'The agent is no longer waiting on that request'
    );
    expect(await controller.respond(approval)).toBe(true);
    dispose();
  });

  it('releases answers after a network error or a disappearing session', async () => {
    const { controller, issue, onFailure, setSessionId, dispose } = setup();
    issue.mockRejectedValueOnce(new Error('network'));
    expect(await controller.respond(answer)).toBe(false);
    expect(controller.answering(answer)).toBe(false);
    expect(onFailure).toHaveBeenCalledExactlyOnceWith(
      "Couldn't send your answer"
    );
    issue.mockReturnValueOnce(undefined);
    expect(await controller.respond(answer)).toBe(false);
    expect(onFailure).toHaveBeenCalledTimes(1);
    setSessionId(undefined);
    expect(await controller.respond(approval)).toBe(false);
    expect(issue).toHaveBeenCalledTimes(2);
    dispose();
  });

  it('keeps in-flight answers scoped to the session that issued them', async () => {
    const { controller, issue, setSessionId, dispose } = setup();
    const releases: ((result: IssueResult) => void)[] = [];
    issue.mockImplementation(
      () => new Promise((resolve) => releases.push(resolve))
    );
    const first = controller.respond(approval);
    setSessionId('session-b');
    expect(controller.answering(approval)).toBe(false);
    const second = controller.respond(approval);
    releases[0](accepted);
    await first;
    expect(controller.answering(approval)).toBe(true);
    releases[1](accepted);
    await second;
    expect(controller.answering(approval)).toBe(false);
    dispose();
  });
});
