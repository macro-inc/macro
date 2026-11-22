import { ThrownResultError } from '@core/util/result';
import { describe, expect, it } from 'vitest';
import { addedAgentProgress, addRefusal } from './team-agent-add';

describe('addedAgentProgress', () => {
  const ada = { userId: 'ada', status: 'provisioning' as const };

  it('waits while the computer is set up and the agent starts', () => {
    expect(addedAgentProgress([ada], 'ada')).toBe('waiting');
    expect(addedAgentProgress([{ ...ada, status: 'starting' }], 'ada')).toBe(
      'waiting'
    );
    // A computer that stopped answering comes back by itself.
    expect(addedAgentProgress([{ ...ada, status: 'unhealthy' }], 'ada')).toBe(
      'waiting'
    );
  });

  it('waits while an own machine downloads the runtime', () => {
    expect(
      addedAgentProgress([{ userId: 'agent', status: 'downloading' }], 'agent')
    ).toBe('waiting');
  });

  it('stops at a started computer when the wait ends there', () => {
    expect(
      addedAgentProgress([{ ...ada, status: 'starting' }], 'ada', 'computer_up')
    ).toBe('online');
    expect(addedAgentProgress([ada], 'ada', 'computer_up')).toBe('waiting');
  });

  it('is online once the agent reported itself running', () => {
    expect(addedAgentProgress([{ ...ada, status: 'running' }], 'ada')).toBe(
      'online'
    );
  });

  it('reads a released or vanished agent as gone', () => {
    expect(addedAgentProgress([{ ...ada, status: 'released' }], 'ada')).toBe(
      'gone'
    );
    expect(addedAgentProgress([], 'ada')).toBe('gone');
  });

  it('reads a failed computer as failed', () => {
    expect(addedAgentProgress([{ ...ada, status: 'failed' }], 'ada')).toBe(
      'failed'
    );
  });
});

describe('addRefusal', () => {
  const refused = (code: string) =>
    addRefusal(new ThrownResultError([{ code, message: code }]));

  it('reads a declined card and a full size as their own states', () => {
    expect(refused('PAYMENT_DECLINED')).toEqual({ kind: 'declined' });
    expect(refused('NO_ROOM')).toEqual({ kind: 'no_room' });
  });

  it('names the other refusals, and anything else as unknown', () => {
    expect(refused('INVITE_IN_PROGRESS')).toEqual({
      kind: 'refused',
      reason: 'in_progress',
    });
    expect(refused('HOST_NOT_ELIGIBLE')).toEqual({
      kind: 'refused',
      reason: 'host_not_eligible',
    });
    expect(refused('SELF_HOSTED_NOT_ENABLED')).toEqual({
      kind: 'refused',
      reason: 'self_hosted_not_enabled',
    });
    expect(refused('SOMETHING_NEW')).toEqual({
      kind: 'refused',
      reason: 'unknown',
    });
    expect(addRefusal(new Error('network'))).toEqual({
      kind: 'refused',
      reason: 'unknown',
    });
  });
});

describe('a status this build does not know', () => {
  it('keeps waiting, so the dialog falls back to the slow path', () => {
    const unknown = JSON.parse('{"userId":"ada","status":"hibernating"}');
    expect(addedAgentProgress([unknown], 'ada')).toBe('waiting');
  });
});
