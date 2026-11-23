import { t } from '@app/lib/i18n';
import { fireAndForget } from '@core/util/fireAndForget';
import { pendingWebUpdate } from '@core/util/reloadForNewerBuild';
import { retryingFailedInstall, useTauri } from '@macro/tauri';
import { invoke } from '@tauri-apps/api/core';
import { type Accessor, createMemo } from 'solid-js';

/** An update this app can apply now, as the rail's update button offers it. */
export type AppUpdate = {
  /** Stable per update, so dismissing one doesn't hide the next. */
  id: string;
  title: string;
  description: string;
  actionLabel: string;
  /** The action is running and the popover must stay open. */
  busy: boolean;
  /** The action isn't available yet; the popover can still close. */
  waiting: boolean;
  apply: () => void;
};

type UpdateCopy = Pick<AppUpdate, 'title' | 'description' | 'actionLabel'>;

/**
 * What the popover says for each kind of update, by client. Getters, so the
 * copy follows the interface language; `useAppUpdate` spreads them inside its
 * memo, which re-runs when the language changes.
 */
export const UPDATE_COPY = {
  web: {
    get title() {
      return t('nav.updateNewVersionTitle');
    },
    get description() {
      return t('nav.updateWebDescription');
    },
    get actionLabel() {
      return t('nav.updateReload');
    },
  },
  webFailedLoad: {
    get title() {
      return t('nav.updateNewVersionTitle');
    },
    get description() {
      return t('nav.updateWebFailedLoadDescription');
    },
    get actionLabel() {
      return t('nav.updateReload');
    },
  },
  bundle: {
    get title() {
      return t('nav.updateReadyTitle');
    },
    get description() {
      return t('nav.updateBundleDescription');
    },
    get actionLabel() {
      return t('nav.updateAction');
    },
  },
  native: {
    get title() {
      return t('nav.updateDesktopReadyTitle');
    },
    get description() {
      return t('nav.updateNativeDescription');
    },
    get actionLabel() {
      return t('nav.updateRestartAndUpdate');
    },
  },
  nativeFailedDownloading: {
    get title() {
      return t('nav.updateDesktopFailedTitle');
    },
    get description() {
      return t('nav.updateNativeFailedDownloadingDescription');
    },
    get actionLabel() {
      return t('nav.updateDownloading');
    },
  },
  nativeFailed: {
    get title() {
      return t('nav.updateDesktopFailedTitle');
    },
    get description() {
      return t('nav.updateNativeFailedDescription');
    },
    get actionLabel() {
      return t('nav.updateTryAgain');
    },
  },
  nativePreparing: {
    get title() {
      return t('nav.updateDesktopReadyTitle');
    },
    get description() {
      return t('nav.updateNativePreparingDescription');
    },
    get actionLabel() {
      return t('nav.updatePreparingRestart');
    },
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
 * The update ready to apply, if any: a desktop app update that failed to
 * install last time (offered again once it has downloaded again), a
 * downloaded desktop app update, a downloaded web bundle in the desktop app,
 * or a newer web build.
 */
export function useAppUpdate(): Accessor<AppUpdate | undefined> {
  const tauri = useTauri();

  return createMemo(() => {
    const native = tauri?.nativeUpdateStatus();
    if (tauri && native && retryingFailedInstall(native)) {
      const id = `native-failed:${native.failedInstallVersion}`;
      if (native.status !== 'Ready') {
        // A new id once it is ready, so the popover opens again for Try again.
        return {
          id: `${id}:downloading`,
          ...UPDATE_COPY.nativeFailedDownloading,
          busy: false,
          waiting: true,
          apply: () => {},
        };
      }
      const preparing = tauri.nativeUpdatePreparing();
      return {
        id,
        ...UPDATE_COPY.nativeFailed,
        ...(preparing && {
          description: UPDATE_COPY.nativePreparing.description,
          actionLabel: UPDATE_COPY.nativePreparing.actionLabel,
        }),
        busy: preparing,
        waiting: false,
        apply: () =>
          fireAndForget(tauri.restartNativeUpdate(), 'native-updates'),
      };
    }

    if (tauri && native?.status === 'Ready') {
      const preparing = tauri.nativeUpdatePreparing();
      return {
        id: `native:${native.data.version}`,
        ...(preparing ? UPDATE_COPY.nativePreparing : UPDATE_COPY.native),
        busy: preparing,
        waiting: false,
        apply: () =>
          fireAndForget(tauri.restartNativeUpdate(), 'native-updates'),
      };
    }

    if (tauri?.bundleUpdateStatus().status === 'Completed') {
      return {
        id: `bundle:${runningBuild()}`,
        ...UPDATE_COPY.bundle,
        busy: false,
        waiting: false,
        apply: () => fireAndForget(invoke('perform_update'), 'bundle-update'),
      };
    }

    const web = pendingWebUpdate();
    if (web) {
      // Each failed load is a new id, so the popover opens again.
      const failed = web.failedLoads ? `:failed-${web.failedLoads}` : '';
      return {
        id: `web:${web.build ?? runningBuild()}${failed}`,
        ...(web.failedLoads ? UPDATE_COPY.webFailedLoad : UPDATE_COPY.web),
        busy: false,
        waiting: false,
        apply: web.reload,
      };
    }

    return undefined;
  });
}
