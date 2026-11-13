import type { ComputerStatus } from '@service-auth/computers';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  forgetSetupTiming,
  formatElapsed,
  setupFailure,
  setupProgressLine,
  setupStages,
  setupStepStartedAt,
} from './setup-progress';

const computer: ComputerStatus = {
  id: 'computer-1',
  name: 'Build machine',
  size: 'standard',
  vcpus: 4,
  memoryGib: 8,
  diskGib: 100,
  catalogEntry: 'standard@2026-11',
  status: 'setting_up',
  billing: 'active',
  setup: { step: 'booting', position: 2, total: 4 },
  poweredOn: false,
  agentCount: 0,
  canUndoCancel: false,
  canRestore: false,
  purchasedBy: 'viewer',
  createdAt: '2026-11-01T00:00:00Z',
};

afterEach(() => {
  forgetSetupTiming(computer.id);
  vi.useRealTimers();
});

describe('formatElapsed', () => {
  it('reads as minutes and seconds, with hours only once needed', () => {
    expect(formatElapsed(0)).toBe('0:00');
    expect(formatElapsed(42_000)).toBe('0:42');
    expect(formatElapsed(725_000)).toBe('12:05');
    expect(formatElapsed(3_729_000)).toBe('1:02:09');
    expect(formatElapsed(-5)).toBe('0:00');
  });
});

describe('setupStages', () => {
  it('marks the phases before the current one done and the sign-in as a later stage', () => {
    const stages = setupStages(computer, {
      signIn: 'needed',
      connected: false,
      signedIn: false,
    });
    expect(stages.map((stage) => [stage.id, stage.state])).toEqual([
      ['billing', 'done'],
      ['creating', 'done'],
      ['booting', 'current'],
      ['connecting', 'upcoming'],
      ['sign_in', 'upcoming'],
    ]);
    expect(stages[2].detail).toBeUndefined();
  });

  it('starts with Updating billing while the purchase is being confirmed, or when the API reports the billing step', () => {
    const confirming = setupStages(
      { ...computer, status: 'purchasing', billing: 'purchasing' },
      { signIn: 'undecided', connected: false, signedIn: false }
    );
    expect(confirming[0]).toMatchObject({
      id: 'billing',
      label: 'Updating billing…',
      state: 'current',
    });
    expect(confirming[1].state).toBe('upcoming');

    const reported = {
      ...computer,
      setup: { step: 'booting' as const, position: 2, total: 4 },
    };
    Reflect.set(reported.setup, 'step', 'billing');
    expect(
      setupStages(reported, {
        signIn: 'undecided',
        connected: false,
        signedIn: false,
      })[0].state
    ).toBe('current');
  });

  it('keeps the sign-in in the list for an agent on Macro credits, marked skipped', () => {
    const stages = setupStages(computer, {
      signIn: 'skipped',
      connected: false,
      signedIn: false,
    });
    expect(stages.map((stage) => stage.id)).toEqual([
      'billing',
      'creating',
      'booting',
      'connecting',
      'sign_in',
    ]);
    expect(stages[4]).toMatchObject({
      state: 'skipped',
      label: 'Sign in to Claude · skipped',
      detail: "Not needed: the agent runs on Macro's Claude.",
    });
  });

  it('words every stage behind the computer as done', () => {
    const stages = setupStages(
      { ...computer, status: 'ready', setup: undefined },
      { signIn: 'needed', connected: true, signedIn: true }
    );
    expect(stages.map((stage) => [stage.label, stage.state])).toEqual([
      ['Billing updated', 'done'],
      ['Computer created', 'done'],
      ['Started up', 'done'],
      ['Connected to Macro', 'done'],
      ['Signed in to Claude', 'done'],
    ]);
  });

  it('puts the server reason, when there is one, before the generic failed copy', () => {
    const withReason = { ...computer, status: 'failed' as const };
    Reflect.set(withReason, 'failureReason', 'The host ran out of disk.');
    expect(
      setupStages(withReason, {
        signIn: 'undecided',
        connected: false,
        signedIn: false,
      })[2].detail
    ).toMatch(/^The host ran out of disk\. The computer could not be set up/);
  });

  it('makes the sign-in current once the computer is up, saying why it waits until connected', () => {
    const up: ComputerStatus = {
      ...computer,
      status: 'ready',
      setup: undefined,
    };
    const waiting = setupStages(up, {
      signIn: 'needed',
      connected: false,
      signedIn: false,
    });
    expect(waiting[4]).toMatchObject({
      id: 'sign_in',
      state: 'current',
      detail: expect.stringContaining('unlocks by itself'),
    });
    const connected = setupStages(up, {
      signIn: 'needed',
      connected: true,
      signedIn: false,
    });
    expect(connected[4].detail).toBeUndefined();
    const done = setupStages(up, {
      signIn: 'needed',
      connected: true,
      signedIn: true,
    });
    expect(done.every((stage) => stage.state === 'done')).toBe(true);
  });

  it('fails the current phase with the reason, and explains a capacity wait', () => {
    const failed = setupStages(
      { ...computer, status: 'failed' },
      { signIn: 'undecided', connected: false, signedIn: false }
    );
    expect(failed[2]).toMatchObject({
      state: 'failed',
      detail: expect.stringContaining('Retry'),
    });
    const waiting = setupStages(
      { ...computer, status: 'waiting_for_capacity', setup: undefined },
      { signIn: 'undecided', connected: false, signedIn: false }
    );
    expect(waiting[1]).toMatchObject({
      state: 'current',
      detail: 'Turn off or release another computer on this host to make room',
    });
  });
});

describe('setupProgressLine', () => {
  const stagesOf = (current: ComputerStatus, signIn: 'needed' | 'skipped') =>
    setupStages(current, { signIn, connected: false, signedIn: false });

  it('names the current stage and how long it has taken', () => {
    expect(
      setupProgressLine(computer, stagesOf(computer, 'needed'), '0:24')
    ).toBe('Starting up · 0:24');
    const billing = { ...computer, status: 'purchasing' as const };
    expect(
      setupProgressLine(billing, stagesOf(billing, 'needed'), '1:05')
    ).toBe('Updating billing… · 1:05');
  });

  it('says a capacity wait is a wait for space, not a stage at work', () => {
    const waiting = {
      ...computer,
      status: 'waiting_for_capacity' as const,
      setup: undefined,
    };
    expect(
      setupProgressLine(waiting, stagesOf(waiting, 'needed'), '3:10')
    ).toBe('Waiting for space on the host · 3:10');
  });

  it('names the sign-in, without a timer, once the computer is up', () => {
    const up = { ...computer, status: 'ready' as const, setup: undefined };
    expect(setupProgressLine(up, stagesOf(up, 'needed'), undefined)).toBe(
      'Sign in to Claude'
    );
    expect(
      setupProgressLine(up, stagesOf(up, 'skipped'), undefined)
    ).toBeUndefined();
  });
});

describe('setupFailure', () => {
  const failureOf = (current: ComputerStatus) =>
    setupFailure(
      current,
      setupStages(current, {
        signIn: 'undecided',
        connected: false,
        signedIn: false,
      })
    );

  it('says which stage failed and why, in one line, with Retry', () => {
    const failed = {
      ...computer,
      status: 'failed' as const,
      setup: { step: 'creating' as const, position: 1, total: 4 },
    };
    Reflect.set(failed, 'failureReason', 'The host ran out of disk.');
    expect(failureOf(failed)).toEqual({
      message: "Couldn't create the computer: the host ran out of disk",
      details:
        'Retry sets it up again at no extra charge. Contact support if it fails again.',
      retryable: true,
    });
  });

  it('keeps an acronym the server leads with, and falls back to the stage alone', () => {
    const failed = { ...computer, status: 'failed' as const };
    Reflect.set(failed, 'failureReason', 'AWS refused the volume');
    expect(failureOf(failed)?.message).toBe(
      "Couldn't start the computer: AWS refused the volume"
    );
    Reflect.set(failed, 'failureReason', null);
    expect(failureOf(failed)?.message).toBe("Couldn't start the computer");
  });

  it('sends a computer needing attention to support, without Retry', () => {
    expect(failureOf({ ...computer, status: 'needs_attention' })).toEqual({
      message: 'Needs attention — contact support',
      retryable: false,
    });
  });

  it('is nothing while setup is under way', () => {
    expect(failureOf(computer)).toBeUndefined();
    expect(
      failureOf({ ...computer, status: 'waiting_for_capacity' })
    ).toBeUndefined();
  });
});

describe('setupStepStartedAt', () => {
  it('takes the start the API reports over anything seen here', () => {
    const reported = {
      ...computer,
      setup: { step: 'booting' as const, position: 2, total: 4 },
    };
    Reflect.set(reported.setup, 'stepStartedAt', '2026-11-01T00:03:00Z');
    expect(setupStepStartedAt(reported)).toBe(
      new Date('2026-11-01T00:03:00Z').getTime()
    );
  });

  it('counts the billing wait from the purchase and later steps from when they were first seen', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-11-01T00:05:00Z'));
    const confirming: ComputerStatus = {
      ...computer,
      status: 'purchasing',
      setup: { step: 'creating', position: 1, total: 4 },
    };
    expect(setupStepStartedAt(confirming)).toBe(
      new Date('2026-11-01T00:00:00Z').getTime()
    );

    vi.setSystemTime(new Date('2026-11-01T00:06:00Z'));
    const bootingSeenAt = setupStepStartedAt(computer);
    expect(bootingSeenAt).toBe(new Date('2026-11-01T00:06:00Z').getTime());

    vi.setSystemTime(new Date('2026-11-01T00:07:00Z'));
    expect(setupStepStartedAt(computer)).toBe(bootingSeenAt);
  });
});
