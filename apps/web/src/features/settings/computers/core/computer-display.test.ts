import type { ComputerStatus } from '@service-auth/computers';
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
  payment: 'paid',
  poweredOn: true,
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
