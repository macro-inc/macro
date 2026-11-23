import type { ConnectorStatus } from '@queries/connectors';
import { match } from 'ts-pattern';
import type {
  Loadable,
  ToolConnectionState,
} from '../context/onboarding-context';

/** An app the user holds, with the server's status for it. */
export type HeldApp = { slug: string; status: ConnectorStatus };

/** The apps that are connected now, by catalog slug. */
export function onboardingConnectedTools(
  apps: readonly HeldApp[]
): ReadonlySet<string> {
  return new Set(
    apps.filter((app) => app.status === 'connected').map((app) => app.slug)
  );
}

/** A tool's tile state from the server's status, GitHub included. */
export function onboardingToolState(
  slug: string,
  apps: Loadable<readonly HeldApp[]>
): ToolConnectionState {
  if (apps.t !== 'ready') return apps.t;
  const status =
    apps.value.find((app) => app.slug === slug)?.status ?? 'notConnected';
  return match(status)
    .with('connected', () => 'connected' as const)
    .with('disabled', () => 'disabled' as const)
    .with('needsReauth', 'notConnected', () => 'available' as const)
    .exhaustive(() => 'available' as const);
}
