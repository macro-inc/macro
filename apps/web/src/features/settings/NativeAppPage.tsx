import { useFeatureFlag } from '@app/lib/analytics/posthog';
import { t } from '@app/lib/i18n';
import {
  disableAutoUpdateUi,
  enableAutoUpdateUiOverride,
} from '@core/constant/featureFlags';
import { NATIVE_APP_TAB_ITEM } from '@core/constant/settingsTabsConfig';
import { fireAndForget } from '@core/util/fireAndForget';
import { isPlatform } from '@core/util/platform';
import {
  type NativeUpdateStatus,
  nativeUpdateDescription,
} from '@macro/tauri/native-updates';
import type { BundleUpdateStatus } from '@macro/tauri/TauriProvider';
import { getVersion } from '@tauri-apps/api/app';
import { invoke } from '@tauri-apps/api/core';
import { ResultAsync } from 'neverthrow';
import { type Accessor, createResource, Show } from 'solid-js';
import { match } from 'ts-pattern';
import {
  getBundleDebugInfo,
  getNativeBuildDate,
  otaBundleDate,
} from './app-build';
import { NativeAppAbout, UpdateStatusRow } from './components/native-app-info';
import {
  type BundleUpdateAction,
  bundleUpdateAction,
} from './core/bundle-update';
import { SettingsCard, SettingsPage, SettingsSection } from './primitives';

/** The update state the Tauri provider keeps; absent outside the native apps. */
export type NativeAppUpdates = {
  bundleUpdateStatus: Accessor<BundleUpdateStatus>;
  nativeUpdateStatus: Accessor<NativeUpdateStatus>;
  nativeUpdatePreparing: Accessor<boolean>;
  restartNativeUpdate: () => Promise<void>;
};

async function installedVersion(): Promise<string> {
  const version = await ResultAsync.fromPromise(getVersion(), (error) => error);
  return version.isOk() ? version.value : t('settingsNativeApp.notAvailable');
}

function bundleUpdateStatusText(status: BundleUpdateStatus): string {
  return match(status)
    .with({ status: 'Idle' }, () => t('settingsNativeApp.statusIdle'))
    .with({ status: 'CheckingForUpdate' }, () =>
      t('settingsNativeApp.statusChecking')
    )
    .with({ status: 'UpdateFound' }, ({ data }) =>
      t('settingsNativeApp.statusUpdateFound', { version: data.version })
    )
    .with({ status: 'NoUpdateNeeded' }, () =>
      t('settingsNativeApp.statusUpToDate')
    )
    .with({ status: 'WaitingForWifi' }, () =>
      t('settingsNativeApp.statusWaitingForWifi')
    )
    .with({ status: 'Downloading' }, ({ data }) =>
      t('settingsNativeApp.statusDownloading', {
        progress: Math.round(data.progress),
      })
    )
    .with({ status: 'Unzipping' }, ({ data }) =>
      t('settingsNativeApp.statusInstalling', {
        progress: Math.round(data.progress),
      })
    )
    .with({ status: 'ClearRequired' }, () =>
      t('settingsNativeApp.statusClearRequired')
    )
    .with({ status: 'NativeUpdateRequired' }, () =>
      t('settingsNativeApp.statusNativeUpdateRequired')
    )
    .with({ status: 'Completed' }, () => t('settingsNativeApp.statusCompleted'))
    .with({ status: 'Error' }, () => t('settingsNativeApp.statusError'))
    .exhaustive(() => t('settingsNativeApp.statusIdle'));
}

/** Runs an App update action through the bundle updater. */
function runBundleUpdateAction(action: BundleUpdateAction) {
  const command = match(action)
    .with('check', 'retry', () => invoke('check_for_update'))
    .with('download', 'downloadAnyway', () =>
      invoke('grant_bundle_update', { approved: true })
    )
    .with('reload', 'update', () => invoke('perform_update'))
    .exhaustive();
  fireAndForget(command, 'bundle-update');
}

function bundleUpdateActionLabel(action: BundleUpdateAction): string {
  return match(action)
    .with('check', () => t('settingsNativeApp.checkForUpdates'))
    .with('retry', () => t('settingsNativeApp.retry'))
    .with('download', () => t('settingsNativeApp.download'))
    .with('downloadAnyway', () => t('settingsNativeApp.downloadAnyway'))
    .with('reload', () => t('settingsNativeApp.reload'))
    .with('update', () => t('settingsNativeApp.update'))
    .exhaustive();
}

/** The mobile apps' over-the-air bundle updates. */
function AppUpdateRow(props: { updates?: NativeAppUpdates }) {
  const status = (): BundleUpdateStatus =>
    props.updates?.bundleUpdateStatus() ?? { status: 'Idle' };
  const action = () => {
    const next = bundleUpdateAction(status());
    if (!next) return undefined;
    return {
      label: bundleUpdateActionLabel(next),
      onClick: () => runBundleUpdateAction(next),
    };
  };

  return (
    <UpdateStatusRow
      label={t('settingsNativeApp.appUpdate')}
      status={bundleUpdateStatusText(status())}
      action={action()}
    />
  );
}

/** The desktop app's own updater, which replaces the installed app. */
function DesktopAppUpdateRow(props: { updates?: NativeAppUpdates }) {
  return (
    <Show when={props.updates}>
      {(desktop) => (
        <UpdateStatusRow
          label={t('settingsNativeApp.desktopAppUpdate')}
          status={nativeUpdateDescription(desktop().nativeUpdateStatus())}
          action={
            desktop().nativeUpdateStatus().status === 'Ready'
              ? {
                  label: t('settingsNativeApp.restartToUpdate'),
                  disabled: desktop().nativeUpdatePreparing(),
                  onClick: () =>
                    fireAndForget(
                      desktop().restartNativeUpdate(),
                      'native-updates'
                    ),
                }
              : undefined
          }
        />
      )}
    </Show>
  );
}

/**
 * The installed app's version, build dates and updates, titled for the
 * platform. Mount only inside the native apps; it reads them over IPC.
 * `updates` is the Tauri provider's state (see `NativeApp`).
 */
export function NativeAppPage(props: { updates?: NativeAppUpdates }) {
  const inDesktopApp = isPlatform('desktop');
  const disableAutoUpdateUiFlag = useFeatureFlag(disableAutoUpdateUi);
  // The over-the-air bundle and its updates stay out of sight where the flag
  // asks; the desktop app's own updater is not over the air.
  const showOta = () =>
    enableAutoUpdateUiOverride ?? !disableAutoUpdateUiFlag().enabled;
  // Read once loaded, never while pending: a pending read would suspend the
  // settings tab's boundary and blank the page until every IPC call answers.
  const [versionResource] = createResource(installedVersion);
  const [bundleResource] = createResource(getBundleDebugInfo);
  const [buildDateResource] = createResource(getNativeBuildDate);
  const version = () =>
    versionResource.state === 'ready' ? versionResource() : undefined;
  const bundleInfo = () =>
    bundleResource.state === 'ready' ? bundleResource() : undefined;
  const buildDate = () =>
    buildDateResource.state === 'ready' ? buildDateResource() : undefined;
  const showUpdates = () => {
    if (!inDesktopApp) return showOta();
    const status = props.updates?.nativeUpdateStatus().status;
    return status !== undefined && status !== 'Disabled';
  };

  return (
    <SettingsPage
      title={NATIVE_APP_TAB_ITEM.label}
      description={t('settingsNativeApp.description')}
    >
      <SettingsSection title={t('settingsNativeApp.aboutTitle')} target="About">
        <NativeAppAbout
          version={version()}
          build={bundleInfo()?.nativeBuild || undefined}
          buildDate={buildDate()}
          showBundle={showOta()}
          bundleSource={bundleInfo()?.source}
          bundleDate={otaBundleDate(bundleInfo())}
        />
      </SettingsSection>
      <Show when={showUpdates()}>
        <SettingsSection
          title={t('settingsNativeApp.updatesTitle')}
          target="Updates"
        >
          <SettingsCard>
            <Show
              when={inDesktopApp}
              fallback={<AppUpdateRow updates={props.updates} />}
            >
              <DesktopAppUpdateRow updates={props.updates} />
            </Show>
          </SettingsCard>
        </SettingsSection>
      </Show>
    </SettingsPage>
  );
}
