import { render } from '@solidjs/testing-library';
import type { JSX } from 'solid-js';
import { AuthProvider } from '../context/auth-context';
import { createFakeAuth, type FakeAuthWorld } from './fake-auth-context';

/** Render `ui` under a fake auth backend seeded with `world`. */
export function renderWithFakeAuth(
  ui: () => JSX.Element,
  world: Partial<FakeAuthWorld> = {},
  options: Parameters<typeof createFakeAuth>[1] = {}
) {
  const fake = createFakeAuth(world, options);
  const result = render(() => (
    <AuthProvider value={fake.context}>{ui()}</AuthProvider>
  ));
  return { ...result, fake };
}
