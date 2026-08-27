/**
 * The latch this exists to prevent: a model change is user-authored and
 * never gets a stop reason, so a naive read of the transcript's tail says
 * "the agent is working" forever after one.
 */

import type { FoldedMessage } from '@service-agent-fold/generated/types';
import { describe, expect, it } from 'vitest';
import {
  isControlMessage,
  isTurnInFlight,
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
const modelChange = (id: number) =>
  message(id, 'user', [
    {
      kind: 'control',
      control: { kind: 'set_model', model: 'github-copilot/gpt-5.6-terra' },
      outcome: { kind: 'accepted' },
    },
  ]);
const stop = (id: number) =>
  message(id, 'user', [
    {
      kind: 'control',
      control: { kind: 'stop' },
      outcome: { kind: 'accepted' },
    },
  ]);

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

describe('isTurnInFlight', () => {
  it('is true while the agent message has no stop reason', () => {
    expect(isTurnInFlight([prompt(0), reply(0, false)])).toBe(true);
  });

  it('is false once the agent message has a stop reason', () => {
    expect(isTurnInFlight([prompt(0), reply(0, true)])).toBe(false);
  });

  it('treats a later stop as ending a still-open thought', () => {
    expect(isTurnInFlight([prompt(0), reply(0, false), stop(1)])).toBe(false);
  });

  it('treats a stop after a prompt with no reply as ending the wait', () => {
    expect(isTurnInFlight([prompt(0), stop(1)])).toBe(false);
  });

  it('does not treat a model change as ending a running turn', () => {
    expect(isTurnInFlight([prompt(0), reply(0, false), modelChange(1)])).toBe(
      true
    );
  });
});
