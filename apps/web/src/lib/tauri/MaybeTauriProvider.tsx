import { isTauri } from '@core/util/platform';
import { PlatformNotificationProvider } from '@notifications/components/PlatformNotificationProvider';
import type { RouteSectionProps } from '@solidjs/router';
import { type JSX, lazy, Suspense } from 'solid-js';

const TauriShell = lazy(() =>
  import('./TauriProvider').then((module) => ({
    default: module.MaybeTauriProvider,
  }))
);
const TauriRouteListenerImpl = lazy(() =>
  import('./TauriProvider').then((module) => ({
    default: module.TauriRouteListener,
  }))
);

/** Web-safe shell. The native CallKit/Tauri graph stays behind this lazy. */
export function MaybeTauriProvider(props: { children: JSX.Element }) {
  if (!isTauri()) {
    return (
      <PlatformNotificationProvider>
        {props.children}
      </PlatformNotificationProvider>
    );
  }

  return (
    <Suspense>
      <TauriShell>{props.children}</TauriShell>
    </Suspense>
  );
}

/** Web-safe passthrough. Tauri navigation effects stay behind this lazy. */
export function TauriRouteListener(props: RouteSectionProps) {
  if (!isTauri()) {
    return props.children;
  }

  return (
    <Suspense>
      <TauriRouteListenerImpl {...props} />
    </Suspense>
  );
}
