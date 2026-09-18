/** @vitest-environment jsdom */
import type { IssueResult } from '@core/agent-session/AgentSession';
import type { AgentAction } from '@service-agent-harness/generated/schemas';
import { err, ok } from 'neverthrow';
import { createRoot, createSignal } from 'solid-js';
import { describe, expect, it, vi } from 'vitest';
import { createPermissionController } from './create-permission-controller';

vi.mock('@core/component/Toast/Toast', () => ({ toast: { failure: vi.fn() } }));
const answer = { kind: 'selected', optionId: 'once' } as const;
const accepted: IssueResult = ok({ actionId: 'accepted', status: 'sent' });

function setup(canEdit = true, result = accepted) {
  const [sessionId, setSessionId] = createSignal('session-a');
  const issue = vi.fn((_action: AgentAction) => Promise.resolve(result));
  const { controller, dispose } = createRoot((dispose) => ({
    controller: createPermissionController({
      sessionId,
      canEdit: () => canEdit,
      issue,
    }),
    dispose,
  }));
  return { controller, dispose, issue, setSessionId };
}

describe('permission responses', () => {
  it('preserves numeric and string request ids and prevents duplicate answers', async () => {
    const { controller, issue, dispose } = setup();
    const first = controller.respond(7, answer);
    expect(controller.answering(7)).toBe(true);
    expect(controller.answering('7')).toBe(false);
    expect(await controller.respond(7, { kind: 'cancelled' })).toBe(false);
    expect(await first).toBe(true);
    expect(controller.answering(7)).toBe(false);
    await controller.respond('7', answer);
    expect(issue.mock.calls.map(([action]) => action)).toEqual([
      { type: 'respondToPermission', requestId: 7, answer },
      { type: 'respondToPermission', requestId: '7', answer },
    ]);
    dispose();
  });

  it('does not send an answer for a viewer', async () => {
    const { controller, issue, dispose } = setup(false);
    expect(controller.canAnswer()).toBe(false);
    expect(await controller.respond(7, answer)).toBe(false);
    expect(issue).not.toHaveBeenCalled();
    dispose();
  });

  it('releases a refused answer so it can be retried', async () => {
    const { controller, issue, dispose } = setup(
      true,
      err([{ code: 'CONFLICT', message: 'answered' }])
    );
    expect(await controller.respond(7, answer)).toBe(false);
    expect(controller.answering(7)).toBe(false);
    issue.mockResolvedValue(accepted);
    expect(await controller.respond(7, answer)).toBe(true);
    dispose();
  });
  it('keeps in-flight answers scoped to the session that issued them', async () => {
    const { controller, issue, setSessionId, dispose } = setup();
    const releases: ((result: IssueResult) => void)[] = [];
    issue.mockImplementation(
      () => new Promise((resolve) => releases.push(resolve))
    );
    const first = controller.respond(7, answer);
    setSessionId('session-b');
    expect(controller.answering(7)).toBe(false);
    const second = controller.respond(7, answer);
    expect(controller.answering(7)).toBe(true);
    releases[0](accepted);
    await first;
    expect(controller.answering(7)).toBe(true);
    releases[1](accepted);
    await second;
    expect(controller.answering(7)).toBe(false);
    dispose();
  });
});
