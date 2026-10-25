import { ConnectorImportPromotion } from '@app/features/connector-import/connector-import';
import {
  allOf,
  flagVerdict,
} from '@app/features/sidebar-promotion/sidebar-promotion';
import { useFeatureFlag } from '@app/lib/analytics/posthog';
import { openNewChannelModal } from '@channel/CreateChannelModal';
import { enableSlackArchiveImport } from '@core/constant/featureFlags';
import { lazyNamed } from '@core/util/lazyNamed';
import FileZipIcon from '@phosphor/file-zip.svg';
import { useCurrentTeamQuery, useIsTeamAdmin } from '@queries/team/teams';
import { Show, Suspense } from 'solid-js';

// The archive dialog's code loads behind the card, which renders at once.
const SlackImport = lazyNamed(() => import('./slack-import'), 'SlackImport');

/**
 * The Channels rail's Slack card: the shared connector-import card, whose
 * dialog picks channels through the Slack connector and hands history
 * imports to the archive dialog. Its second button creates a channel from
 * scratch instead.
 */
export function SlackImportSidebar() {
  const flag = useFeatureFlag(enableSlackArchiveImport);
  const team = useCurrentTeamQuery(() => flag().enabled);
  const isAdmin = useIsTeamAdmin();
  const teamId = () => (team.isSuccess ? team.data?.team.id : undefined);
  let openHistory: ((opener: HTMLButtonElement) => void) | undefined;

  return (
    <>
      <Show when={flag().enabled && isAdmin() && teamId()}>
        {(id) => (
          <Suspense>
            <SlackImport
              teamId={id()}
              isAdmin={isAdmin()}
              historyOnly
              trigger={(open) => {
                // The archive dialog has no button of its own here; the
                // card's "Import with history" option opens it.
                openHistory = open;
                return null;
              }}
            />
          </Suspense>
        )}
      </Show>
      <ConnectorImportPromotion
        category="channels"
        class="px-(--sidebar-gutter) py-2"
        applies={allOf(
          flagVerdict(flag()),
          team.isSuccess ? isAdmin() && !!teamId() : undefined
        )}
        alternatives={[
          {
            icon: FileZipIcon,
            label: 'Import with history',
            description:
              'Upload a Slack export from a workspace owner or admin.',
            onSelect: (opener) => {
              if (opener) openHistory?.(opener);
            },
          },
        ]}
        actionLabel="Import Slack"
        secondaryAction={{
          label: 'New channel',
          onClick: () => openNewChannelModal(),
        }}
      />
    </>
  );
}
