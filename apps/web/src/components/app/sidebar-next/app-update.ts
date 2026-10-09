import { pendingWebUpdate } from '@core/util/reloadForNewerBuild';
import { useTauri } from '@macro/tauri';
import { invoke } from '@tauri-apps/api/core';
import { type Accessor, createMemo } from 'solid-js';

/** An update this app can apply now, as the rail's update button offers it. */
export type AppUpdate = {
  /** Stable per update, so dismissing one doesn't hide the next. */
  id: string;
  description: string;
  actionLabel: string;
  /** The action is running and the popover must stay open. */
  busy: boolean;
  apply: () => void;
};

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
    const native = tauri?.nativeUpdateStatus();
    if (tauri && native?.status === 'Ready') {
      const preparing = tauri.nativeUpdatePreparing();
      return {
        id: `native:${native.data.version}`,
        description:
          'Restart to install it, or keep working and it will update when you quit.',
        actionLabel: preparing ? 'Preparing to restart…' : 'Restart and update',
        busy: preparing,
        apply: () => void tauri.restartNativeUpdate(),
      };
    }

    if (tauri?.bundleUpdateStatus().status === 'Completed') {
      return {
        id: `bundle:${runningBuild()}`,
        description: 'Update to start using it.',
        actionLabel: 'Update',
        busy: false,
        apply: () => void invoke('perform_update'),
      };
    }

    const web = pendingWebUpdate();
    if (web) {
      return {
        id: `web:${web.build ?? runningBuild()}`,
        description: 'Reload to start using it.',
        actionLabel: 'Reload',
        busy: false,
        apply: web.reload,
      };
    }

    return undefined;
  });
}
