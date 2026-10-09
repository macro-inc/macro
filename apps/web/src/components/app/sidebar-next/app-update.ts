import { pendingWebUpdate } from '@core/util/reloadForNewerBuild';
import { useTauri } from '@macro/tauri';
import { invoke } from '@tauri-apps/api/core';
import { type Accessor, createMemo } from 'solid-js';
import { debugAppUpdate } from './app-update-debug';

/** An update this app can apply now, as the rail's update button offers it. */
export type AppUpdate = {
  /** Stable per update, so dismissing one doesn't hide the next. */
  id: string;
  title: string;
  description: string;
  actionLabel: string;
  /** The action is running and the popover must stay open. */
  busy: boolean;
  apply: () => void;
};

type UpdateCopy = Pick<AppUpdate, 'title' | 'description' | 'actionLabel'>;

/** What the popover says for each kind of update, by client. */
export const UPDATE_COPY = {
  web: {
    title: 'New version available',
    description: 'A new version of Macro is ready. Reload the page to use it.',
    actionLabel: 'Reload',
  },
  bundle: {
    title: 'Update ready',
    description:
      'A new version of the Macro desktop app has downloaded. Update to start using it.',
    actionLabel: 'Update',
  },
  native: {
    title: 'Desktop app update ready',
    description:
      'Restart Macro to install it, or keep working and it installs when you quit.',
    actionLabel: 'Restart and update',
  },
  nativePreparing: {
    title: 'Desktop app update ready',
    description:
      'Saving your work before Macro restarts to install the update.',
    actionLabel: 'Preparing to restart…',
  },
} satisfies Record<string, UpdateCopy>;

/** The bundle build this page booted, from index.html. */
function runningBuild(): string {
  return (
    document
      .querySelector<HTMLMetaElement>('meta[name="macro-bundle-build"]')
      ?.getAttribute('content') ?? ''
  );
}

/**
 * The update ready to apply, if any: a downloaded desktop app update, a
 * downloaded web bundle in the desktop app, or a newer web build.
 */
export function useAppUpdate(): Accessor<AppUpdate | undefined> {
  const tauri = useTauri();

  return createMemo(() => {
    // TEMPORARY: simulated updates from the debug panel.
    const simulated = debugAppUpdate();
    if (simulated) return simulated;

    const native = tauri?.nativeUpdateStatus();
    if (tauri && native?.status === 'Ready') {
      const preparing = tauri.nativeUpdatePreparing();
      return {
        id: `native:${native.data.version}`,
        ...(preparing ? UPDATE_COPY.nativePreparing : UPDATE_COPY.native),
        busy: preparing,
        apply: () => void tauri.restartNativeUpdate(),
      };
    }

    if (tauri?.bundleUpdateStatus().status === 'Completed') {
      return {
        id: `bundle:${runningBuild()}`,
        ...UPDATE_COPY.bundle,
        busy: false,
        apply: () => void invoke('perform_update'),
      };
    }

    const web = pendingWebUpdate();
    if (web) {
      return {
        id: `web:${web.build ?? runningBuild()}`,
        ...UPDATE_COPY.web,
        busy: false,
        apply: web.reload,
      };
    }

    return undefined;
  });
}
