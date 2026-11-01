import { QUICK_CONNECT_SERVERS } from '@core/component/AI/constant/mcpServers';
import { canonicalPipedreamSlug } from '@core/pipedream/slugs';
import type {
  Loadable,
  ToolConnectionState,
} from '../context/onboarding-context';

type NativeConnection = {
  url: string;
  authenticated: boolean;
  enabled: boolean;
};

/** Identify native providers by endpoint, not their editable display name. */
export function onboardingConnectedTools(
  pipedream: ReadonlySet<string>,
  native: readonly NativeConnection[],
  githubLinked = false
): ReadonlySet<string> {
  const connected = new Set([...pipedream].map(canonicalPipedreamSlug));
  for (const server of native) {
    if (!server.authenticated || !server.enabled) continue;
    const preset = QUICK_CONNECT_SERVERS.find(
      (preset) => preset.url === server.url.replace(/\/+$/, '')
    );
    if (preset) connected.add(canonicalPipedreamSlug(preset.app_slug));
  }
  // The GitHub card links Macro's native account, not an MCP connector.
  connected.delete('github');
  if (githubLinked) connected.add('github');
  return connected;
}

export function nativeToolSlug(server: NativeConnection): string | undefined {
  return QUICK_CONNECT_SERVERS.find(
    (preset) => preset.url === server.url.replace(/\/+$/, '')
  )?.app_slug;
}

/** A known successful connection remains usable when an unrelated source fails. */
export function onboardingToolState(
  slug: string,
  pipedream: Loadable<readonly { app_slug: string; enabled: boolean }[]>,
  native: Loadable<readonly NativeConnection[]>,
  github: Loadable<string>
): ToolConnectionState {
  slug = canonicalPipedreamSlug(slug);
  if (slug === 'github') {
    return github.t === 'ready'
      ? github.value === 'linked'
        ? 'account-linked'
        : 'available'
      : github.t;
  }
  const nativeMatches =
    native.t === 'ready'
      ? native.value.filter(
          (server) => nativeToolSlug(server) === slug && server.authenticated
        )
      : [];
  const pdMatches =
    pipedream.t === 'ready'
      ? pipedream.value.filter(
          (server) => canonicalPipedreamSlug(server.app_slug) === slug
        )
      : [];
  if (
    nativeMatches.some((server) => server.enabled) ||
    pdMatches.some((server) => server.enabled)
  )
    return 'connected';
  if (nativeMatches.length || pdMatches.length) return 'disabled';
  const hasNativeProvider = QUICK_CONNECT_SERVERS.some(
    (server) => server.app_slug === slug
  );
  if (pipedream.t === 'error' || (hasNativeProvider && native.t === 'error'))
    return 'error';
  if (
    pipedream.t === 'loading' ||
    (hasNativeProvider && native.t === 'loading')
  )
    return 'loading';
  return 'available';
}
