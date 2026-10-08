import { render } from '@solidjs/testing-library';
import type { JSX } from 'solid-js';
import { vi } from 'vitest';
import { OnboardingProvider } from '../context/onboarding-context';
import {
  createFakeOnboarding,
  type FakeOnboardingWorld,
} from './fake-onboarding-context';

/** Reduced motion skips the WAAPI handoffs jsdom can't run. */
export function stubOnboardingBrowser() {
  vi.stubGlobal('matchMedia', () => ({ matches: true }));
  HTMLElement.prototype.scrollTo = vi.fn();
}

/** Render `ui` under a fake onboarding backend seeded with `world`. */
export function renderWithFakeOnboarding(
  ui: () => JSX.Element,
  world: Partial<FakeOnboardingWorld> = {}
) {
  const fake = createFakeOnboarding(world);
  const result = render(() => (
    <OnboardingProvider value={fake.context}>{ui()}</OnboardingProvider>
  ));
  return { ...result, fake };
}
