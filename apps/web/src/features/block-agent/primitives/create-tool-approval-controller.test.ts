/** @vitest-environment jsdom */
import type { PendingInteraction } from '@service-agent-fold/generated/types';
import { err, ok } from 'neverthrow';
import { createRoot, createSignal } from 'solid-js';
import { describe, expect, it, vi } from 'vitest';
import {
  createToolApprovalController,
  type ToolApprovalSource,
} from './create-tool-approval-controller';

const held = {
  kind: 'tool_approval',
  approvalId: 'approval-1',
  turn: 0,
  serverSlug: 'macro',
  serverName: 'Macro',
  toolName: 'ListEmails',
  requestedBy: 'macro|julia@macro.com',
} satisfies PendingInteraction;

const permission = {
  kind: 'permission',
  requestId: 7,
  turn: 0,
  toolCall: 'tool',
  options: [],
} satisfies PendingInteraction;

type Answer = ToolApprovalSource['answer'];

function setup(viewer: string, canEdit = true) {
  const [pending, setPending] = createSignal<PendingInteraction[]>([
    permission,
    held,
  ]);
  const answer = vi.fn<Answer>(() =>
    Promise.resolve(ok({ status: 'approved' as const }))
  );
  const onFailure = vi.fn();
  const { controller, dispose } = createRoot((dispose) => ({
    controller: createToolApprovalController({
      sessionId: () => 'session-a',
      pending,
      ownerId: () => 'macro|wolf@macro.com',
      userId: () => viewer,
      canEdit: () => canEdit,
      onFailure,
      answer,
    }),
    dispose,
  }));
  return { controller, dispose, answer, onFailure, setPending };
}

describe('createToolApprovalController', () => {
  it('lists only held tool calls', () => {
    const { controller, dispose } = setup('macro|wolf@macro.com');
    expect(controller.pending()).toEqual([held]);
    dispose();
  });

  it('lets the owner approve and decline', async () => {
    const { controller, dispose, answer } = setup('macro|wolf@macro.com');
    expect(controller.canApprove()).toBe(true);
    await expect(controller.answer('approval-1', 'approve')).resolves.toBe(
      true
    );
    expect(answer).toHaveBeenCalledWith('session-a', 'approval-1', 'approve');
    dispose();
  });

  it('lets an editor only cancel', async () => {
    const { controller, dispose, answer } = setup('macro|julia@macro.com');
    expect(controller.canApprove()).toBe(false);
    expect(controller.canCancel()).toBe(true);
    await expect(controller.answer('approval-1', 'approve')).resolves.toBe(
      false
    );
    expect(answer).not.toHaveBeenCalled();
    await expect(controller.answer('approval-1', 'cancel')).resolves.toBe(true);
    expect(answer).toHaveBeenCalledWith('session-a', 'approval-1', 'cancel');
    dispose();
  });

  it('lets a viewer do nothing', async () => {
    const { controller, dispose, answer } = setup(
      'macro|visitor@macro.com',
      false
    );
    await expect(controller.answer('approval-1', 'cancel')).resolves.toBe(
      false
    );
    expect(answer).not.toHaveBeenCalled();
    dispose();
  });

  it('does not answer a call that is no longer held', async () => {
    const { controller, dispose, answer, setPending } = setup(
      'macro|wolf@macro.com'
    );
    setPending([]);
    await expect(controller.answer('approval-1', 'deny')).resolves.toBe(false);
    expect(answer).not.toHaveBeenCalled();
    dispose();
  });

  it('says so when somebody answered first', async () => {
    const { controller, dispose, answer, onFailure } = setup(
      'macro|wolf@macro.com'
    );
    answer.mockResolvedValueOnce(
      err([{ code: 'CONFLICT' as const, message: 'already resolved' }])
    );
    await expect(controller.answer('approval-1', 'deny')).resolves.toBe(false);
    expect(onFailure).toHaveBeenCalledWith(
      'That tool call was already answered'
    );
    dispose();
  });
});
