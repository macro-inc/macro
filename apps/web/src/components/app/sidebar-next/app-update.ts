import { t } from '@app/lib/i18n';
import { fireAndForget } from '@core/util/fireAndForget';
import { pendingWebUpdate } from '@core/util/reloadForNewerBuild';
import { useTauri } from '@macro/tauri';
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
        ...(preparing ? UPDATE_COPY.nativePreparing : UPDATE_COPY.native),
        busy: preparing,
        apply: () =>
          fireAndForget(tauri.restartNativeUpdate(), 'native-updates'),
      };
    }

    if (tauri?.bundleUpdateStatus().status === 'Completed') {
      return {
        id: `bundle:${runningBuild()}`,
        ...UPDATE_COPY.bundle,
        busy: false,
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
        apply: web.reload,
      };
    }

    return undefined;
  });
}
