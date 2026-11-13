import { ThrownResultError } from '@core/util/result';
import type { ComputerStatus, SetupStep } from '@service-auth/computers';
import { describe, expect, it } from 'vitest';
import {
  canTogglePower,
  computerFailureMessage,
  computerStatusLabel,
  offersFailure,
} from './computer-display';

const waiting: ComputerStatus = {
  id: 'computer-capacity-test',
  name: 'Test computer',
  size: 'standard',
  vcpus: 4,
  memoryGib: 8,
  diskGib: 100,
  catalogEntry: 'standard@2026-11',
  status: 'waiting_for_capacity',
  billing: 'active',
  poweredOn: true,
  agentCount: 0,
  canUndoCancel: false,
  canRestore: false,
  purchasedBy: 'viewer',
  createdAt: '2026-11-01T00:00:00Z',
};

describe('capacity waiting', () => {
  it.each([false, true])(
    'is actionable when first enrollment is %s',
    (enrolled) => {
      const computer = {
        ...waiting,
        harnessId: enrolled ? 'test-harness' : null,
      };
      expect(computerStatusLabel(computer)).toEqual({
        label: 'Waiting for space on the host',
        detail:
          'Turn off or release another computer on this host to make room',
        tone: 'muted',
      });
      expect(canTogglePower(computer)).toBe(true);
    }
  );
});

it('renders absent setup as generic setup without a step detail', () => {
  const status = computerStatusLabel({ ...waiting, status: 'setting_up' });
  expect(status).toEqual({
    label: 'Setting up',
    detail: undefined,
    tone: 'progress',
  });
  expect(status.label).not.toMatch(/paying|payment/i);
});

it.each<{ step: SetupStep; label: string; position: number }>([
  { step: 'creating', label: 'Creating the computer', position: 1 },
  { step: 'booting', label: 'Starting up', position: 2 },
  { step: 'connecting', label: 'Connecting to Macro', position: 3 },
])(
  'renders $step as one of the three setup phases',
  ({ step, label, position }) => {
    const status = computerStatusLabel({
      ...waiting,
      status: 'setting_up',
      setup: { step, position, total: 4 },
    });
    expect(status).toEqual({
      label: 'Setting up',
      detail: `${label} (${position} of 3)`,
      tone: 'progress',
    });
    expect(`${status.label} ${status.detail}`).not.toMatch(/paying|payment/i);
  }
);

it('keeps an unrecognized runtime step generic without exposing raw text', () => {
  const setup: NonNullable<ComputerStatus['setup']> = {
    step: 'creating',
    position: 1,
    total: 4,
  };
  // External responses can be newer than this client without changing its canonical type.
  Reflect.set(setup, 'step', 'unrecognized_runtime_step');
  expect(
    computerStatusLabel({ ...waiting, status: 'setting_up', setup })
  ).toEqual({
    label: 'Setting up',
    detail: undefined,
    tone: 'progress',
  });
});

describe('computerFailureMessage', () => {
  it('shows a translated message for each known failure and the fallback otherwise', () => {
    const failure = (code: string) =>
      new ThrownResultError([{ code, message: 'server wording' }]);

    expect(computerFailureMessage(failure('PAYMENT_FAILED'), 'Fallback')).toBe(
      "Your team's payment method was declined."
    );
    expect(computerFailureMessage(failure('NAME_MISMATCH'), 'Fallback')).toBe(
      "The name you typed doesn't match this computer."
    );
    expect(computerFailureMessage(failure('HTTP_500'), 'Fallback')).toBe(
      'Fallback'
    );
    expect(computerFailureMessage(new Error('boom'), 'Fallback')).toBe(
      'Fallback'
    );
  });
});

describe('offersFailure', () => {
  const failure = (code: string) =>
    new ThrownResultError([{ code, message: 'server wording' }]);

  it('sends plan problems to Billing without a retry', () => {
    expect(offersFailure(failure('NO_PAID_PLAN'))).toEqual({
      message:
        'Computers need a paid Macro plan. Your team does not have one yet.',
      remedy: 'billing',
    });
    expect(offersFailure(failure('TEAM_ON_TRIAL'))).toEqual({
      message:
        'Computers can be added once your trial ends and your team is on a paid plan.',
      remedy: 'billing',
    });
  });

  it('offers nothing to an account outside the rollout', () => {
    expect(offersFailure(failure('ROLLOUT_DISABLED'))).toEqual({
      message: "Computers aren't available for this account yet.",
      remedy: 'none',
    });
  });

  it('names each transient cause and offers a retry', () => {
    expect(offersFailure(failure('COMPUTERS_UNAVAILABLE'))).toEqual({
      message: "Computers aren't available right now. Try again later.",
      remedy: 'retry',
    });
    expect(offersFailure(failure('BILLING_PROVIDER_FAILED'))).toEqual({
      message: "Macro's billing provider didn't answer. Try again in a moment.",
      remedy: 'retry',
    });
    expect(offersFailure(failure('TIMED_OUT'))).toEqual({
      message: 'Loading computer sizes took too long. Try again.',
      remedy: 'retry',
    });
    expect(offersFailure(failure('NETWORK_ERROR'))).toEqual({
      message: "Couldn't reach Macro. Check your connection and try again.",
      remedy: 'retry',
    });
    expect(offersFailure(failure('SERVER_ERROR'))).toEqual({
      message: "Couldn't load computer sizes. Try again.",
      remedy: 'retry',
    });
    expect(offersFailure(new Error('boom')).remedy).toBe('retry');
  });
});
