/**
 * The send-next action against stub session controls: one stop and one
 * expectation for the queue head, the expectation taken back when the stop
 * is refused, and nothing at all while the head a previous press showed as
 * sent is still unconfirmed.
 */

import type { IssueResult } from '@core/agent-session/AgentSession';
import type { TurnState } from '@service-agent-fold/generated/types';
import type {
  AgentAction,
  QueuedActionDto,
} from '@service-agent-harness/generated/schemas';
import { err, ok } from 'neverthrow';
import { describe, expect, it, vi } from 'vitest';
import { createSendNext } from './send-next';

const entry = (actionId: string, prompt: string): QueuedActionDto =>
  ({ actionId, kind: 'prompt', prompt }) as QueuedActionDto;

/** Let awaited promises settle. */
const settle = () => new Promise((resolve) => setTimeout(resolve, 0));

function setup(options: {
  turn?: TurnState;
  entries?: QueuedActionDto[];
  stop?: 'sent' | 'refused';
}) {
  let turn: TurnState = options.turn ?? 'running';
  let entries = options.entries ?? [
    entry('head', 'next'),
    entry('later', 'after'),
  ];
  const issue = vi.fn(
    (_action: AgentAction): Promise<IssueResult> =>
      Promise.resolve(
        (options.stop === 'refused'
          ? err([{ code: 'INTERNAL' }])
          : ok({
              actionId: 'stop-id',
              status: 'sent',
            })) as unknown as IssueResult
      )
  );
  const expected = vi.fn((_actionId: string, _action: AgentAction) => {
    // The session's own record moves the moment a prompt is speculated -
    // ahead of the fold's report - and the composer's list drops the head
    // once the fold shows it.
    turn = 'starting';
    entries = entries.slice(1);
  });
  const retract = vi.fn();
  const sendNext = createSendNext({
    currentTurn: () => turn,
    entries: () => entries,
    issue,
    expect: expected,
    retract,
  });
  return {
    sendNext,
    issue,
    expected,
    retract,
    confirmHead: () => {
      turn = 'running';
    },
  };
}

describe('createSendNext', () => {
  it('stops the running turn and shows the queue head as sent under its own id', () => {
    const { sendNext, issue, expected } = setup({});

    sendNext();

    expect(issue).toHaveBeenCalledExactlyOnceWith({ type: 'stop' });
    expect(expected).toHaveBeenCalledExactlyOnceWith('head', {
      type: 'prompt',
      prompt: 'next',
    });
  });

  it('expects a compact head as a compact', () => {
    const { sendNext, expected } = setup({
      entries: [{ actionId: 'compact-id', kind: 'compact' } as QueuedActionDto],
    });

    sendNext();

    expect(expected).toHaveBeenCalledExactlyOnceWith('compact-id', {
      type: 'compact',
    });
  });

  it('takes the head back when the stop is refused', async () => {
    const { sendNext, retract } = setup({ stop: 'refused' });

    sendNext();
    await settle();

    expect(retract).toHaveBeenCalledExactlyOnceWith('head');
  });

  it('does nothing with an empty queue', () => {
    const { sendNext, issue, expected } = setup({ entries: [] });

    sendNext();

    expect(issue).not.toHaveBeenCalled();
    expect(expected).not.toHaveBeenCalled();
  });

  it('holds a second press until the log confirms the head the first one advanced', () => {
    const { sendNext, issue, expected, confirmHead } = setup({});

    // Two presses back to back: the first head is on its way, and a stop
    // posted now would end the turn that is already ending - the server
    // dispatches the first head when it does, so the second must not read as
    // sent.
    sendNext();
    sendNext();

    expect(issue).toHaveBeenCalledTimes(1);
    expect(expected).toHaveBeenCalledTimes(1);
    expect(expected).toHaveBeenLastCalledWith('head', {
      type: 'prompt',
      prompt: 'next',
    });

    // The first head's row landed: the turn it opened is the server's now,
    // and a stop ends it, which is what dispatches the next head.
    confirmHead();
    sendNext();

    expect(issue).toHaveBeenCalledTimes(2);
    expect(expected).toHaveBeenCalledTimes(2);
    expect(expected).toHaveBeenLastCalledWith('later', {
      type: 'prompt',
      prompt: 'after',
    });
  });

  it('does not advance while a prompt sent from the composer is still unconfirmed', () => {
    const { sendNext, issue, expected } = setup({ turn: 'starting' });

    sendNext();

    expect(issue).not.toHaveBeenCalled();
    expect(expected).not.toHaveBeenCalled();
  });
});
