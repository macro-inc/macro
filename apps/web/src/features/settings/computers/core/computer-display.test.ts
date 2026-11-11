import type { ComputerStatus, SetupStep } from '@service-auth/computers';
import { describe, expect, it } from 'vitest';
import { canTogglePower, computerStatusLabel } from './computer-display';

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
