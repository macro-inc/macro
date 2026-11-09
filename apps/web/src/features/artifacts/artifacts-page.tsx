import { openEntityInSplitFromUnifiedList } from '@app/features/next-soup/utils';
import { useMobileSettings } from '@app/features/settings/context/mobile-settings';
import { SettingsPage } from '@app/features/settings/primitives';
import { t } from '@app/lib/i18n';
import { useGlobalNotificationSource } from '@components/app/GlobalAppState';
import { useUserId } from '@core/context/user';
import { fireAndForget } from '@core/util/fireAndForget';
import type { DocumentEntity, WithNotification } from '@entity';
import { markRowNotificationsSeenOnOpen } from '@notifications/mark-row-seen';
import { createArtifactListSource } from './queries/artifact-source';
import { ArtifactsListView } from './views/artifacts-list-view';

/** Opens an artifact the way any list row opens its document. */
function createArtifactOpener() {
  const notifications = useGlobalNotificationSource();
  return (artifact: WithNotification<DocumentEntity>, event?: MouseEvent) => {
    markRowNotificationsSeenOnOpen(artifact, notifications);
    fireAndForget(
      openEntityInSplitFromUnifiedList(artifact, {
        notificationSource: notifications,
        openInNewSplit: event?.shiftKey,
        referredFrom: 'agents',
      }),
      'artifacts'
    );
  };
}

/** Agents → Artifacts: every HTML document the viewer can open. */
export function ArtifactsPage() {
  const source = createArtifactListSource(
    useUserId(),
    useGlobalNotificationSource()
  );
  const open = createArtifactOpener();
  return <ArtifactsListView source={source} onOpen={open} />;
}

/** Settings → Artifacts: the touch entry to the list the Agents sidebar links on desktop. */
export function ArtifactsSettings() {
  const settings = useMobileSettings();
  const source = createArtifactListSource(
    useUserId(),
    useGlobalNotificationSource()
  );
  const open = createArtifactOpener();
  return (
    <SettingsPage
      title={t('settingsNav.tabArtifacts')}
      bodyClass="[--mobile-content-inset-top:0px]"
    >
      <ArtifactsListView
        source={source}
        onOpen={(artifact, event) => {
          settings.close();
          open(artifact, event);
        }}
      />
    </SettingsPage>
  );
}
