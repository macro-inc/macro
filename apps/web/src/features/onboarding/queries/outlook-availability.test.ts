import { createRoot } from 'solid-js';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createAppOutlookAvailability } from './outlook-availability';

const world = vi.hoisted(() => ({
  microsoftSignup: false,
  outlookAvailable: true,
  /** The `enabled` value each server read was made with. */
  serverAsked: [] as boolean[],
}));
vi.mock('@app/lib/analytics/posthog', () => ({
  useFeatureFlag: (flag: { key: string }) => () => ({
    enabled: flag.key === 'enable-microsoft-signup' && world.microsoftSignup,
  }),
}));
vi.mock('@queries/auth/outlook-link', () => ({
  useOutlookAvailable: (enabled: () => boolean) => () => {
    world.serverAsked.push(enabled());
    return enabled() && world.outlookAvailable;
  },
}));

function availability() {
  return createRoot((dispose) => {
    const available = createAppOutlookAvailability();
    const value = available();
    dispose();
    return value;
  });
}

describe('the work step’s Outlook offer', () => {
  beforeEach(() => {
    world.microsoftSignup = false;
    world.outlookAvailable = true;
    world.serverAsked = [];
  });

  it('stays hidden while enable-microsoft-signup is off, without asking the server', () => {
    expect(availability()).toBe(false);
    expect(world.serverAsked).not.toContain(true);
  });

  it('follows the server once enable-microsoft-signup is on', () => {
    world.microsoftSignup = true;
    expect(availability()).toBe(true);
    world.outlookAvailable = false;
    expect(availability()).toBe(false);
  });
});
