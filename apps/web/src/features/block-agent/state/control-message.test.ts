/**
 * The latch this exists to prevent: a model change is user-authored and
 * never gets a stop reason, so a naive read of the transcript's tail says
 * "the agent is working" forever after one.
 */

import type { FoldedMessage } from '@service-agent-fold/generated/types';
import { describe, expect, it } from 'vitest';
import {
  changingModel,
  hasPendingStop,
  isControlMessage,
  lastTurnMessage,
} from './control-message';

const message = (
  id: number,
  author: 'user' | 'agent',
  parts: FoldedMessage['parts'],
  stop: FoldedMessage['stop'] = null
): FoldedMessage =>
  ({
    turn: id,
    author:
      author === 'user' ? { kind: 'user', userId: null } : { kind: 'agent' },
    parts,
    stop,
  }) as unknown as FoldedMessage;

const prompt = (id: number) =>
  message(id, 'user', [{ kind: 'text', text: 'hi' }]);
const reply = (id: number, stopped: boolean) =>
  message(
    id,
    'agent',
    [{ kind: 'text', text: 'hello' }],
    stopped ? ({ kind: 'end_turn' } as FoldedMessage['stop']) : null
  );
const modelChange = (
  id: number,
  outcome: 'pending' | 'accepted' | 'rejected' = 'accepted',
  pending = false
) => ({
  ...message(id, 'user', [
    {
      kind: 'control',
      control: { kind: 'set_model', model: 'github-copilot/gpt-5.6-terra' },
      outcome:
        outcome === 'rejected'
          ? { kind: 'rejected', message: 'no such model' }
          : { kind: outcome },
    },
  ]),
  pending,
});

describe('isControlMessage', () => {
  it('is the whole message or nothing', () => {
    expect(isControlMessage(modelChange(1))).toBe(true);
    expect(isControlMessage(prompt(1))).toBe(false);
  });
});

describe('lastTurnMessage', () => {
  it('looks past controls to the settled turn behind them', () => {
    const messages = [prompt(0), reply(0, true), modelChange(1)];
    expect(lastTurnMessage(messages)).toBe(messages[1]);
  });

  it('looks past a run of them', () => {
    const messages = [
      prompt(0),
      reply(0, true),
      modelChange(1),
      modelChange(2),
      modelChange(3),
    ];
    expect(lastTurnMessage(messages)).toBe(messages[1]);
  });

  it('still sees a turn that is genuinely running', () => {
    const messages = [prompt(0), reply(0, false), modelChange(1)];
    expect(lastTurnMessage(messages)?.stop).toBeNull();
  });

  it('is undefined when a session has only ever had controls', () => {
    expect(lastTurnMessage([modelChange(0)])).toBeUndefined();
  });
});

describe('changingModel', () => {
  it('is the model of a change still on the wire or unanswered', () => {
    expect(changingModel([prompt(0), modelChange(1, 'pending')], 'old')).toBe(
      'github-copilot/gpt-5.6-terra'
    );
    expect(
      changingModel([prompt(0), modelChange(1, 'accepted', true)], 'old')
    ).toBe('github-copilot/gpt-5.6-terra');
  });

  it('clears once the runtime moved the model or refused the change', () => {
    expect(
      changingModel(
        [modelChange(0, 'accepted')],
        'github-copilot/gpt-5.6-terra'
      )
    ).toBeUndefined();
    expect(changingModel([modelChange(0, 'rejected')], 'old')).toBeUndefined();
    expect(changingModel([modelChange(0, 'accepted')], 'old')).toBeUndefined();
  });
});

describe('hasPendingStop', () => {
  const stop = (id: number, pending: boolean) => ({
    ...message(id, 'user', [
      {
        kind: 'control',
        control: { kind: 'stop' },
        outcome: { kind: 'accepted' },
      },
    ]),
    pending,
  });

  it('sees a stop the log has not confirmed', () => {
    expect(hasPendingStop([prompt(1), stop(2, true)])).toBe(true);
  });

  it('ignores confirmed stops and other pending actions', () => {
    expect(hasPendingStop([prompt(1), stop(2, false)])).toBe(false);
    expect(hasPendingStop([{ ...prompt(1), pending: true }])).toBe(false);
    expect(hasPendingStop([modelChange(1, 'pending', true)])).toBe(false);
  });
});
