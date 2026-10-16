import { IntegrationRow } from '@app/features/settings/primitives';
import { useFeatureFlag } from '@app/lib/analytics/posthog';
import { enableSlackArchiveImport } from '@core/constant/featureFlags';
import { useSettingsState } from '@core/constant/SettingsState';
import { useUserId } from '@core/context/user';
import { usePipedreamMcpFlag } from '@core/pipedream/flag';
import { requestConnectApp } from '@core/pipedream/pendingConnect';
import { SLACK_CONNECT_SLUG } from '@core/pipedream/slugs';
import { holdAutomaticReload } from '@core/util/reloadForNewerBuild';
import SlackIcon from '@icon/mcp-slack.svg';
import {
  invalidateListChannels,
  useListChannelsQuery,
} from '@queries/channel/channels';
import { queryClient } from '@queries/client';
import { revalidateChannelLists } from '@queries/soup/graphql/channel-list-revalidation';
import { invalidateAllSoup } from '@queries/soup/normalized-cache';
import { createConnectionWebsocketEffect } from '@service-connection/websocket';
// ast-grep-ignore: tsx-no-service-client-outside-queries -- Composition only; endpoint calls remain in the query adapter.
import { storageServiceClient } from '@service-storage/client';
import { getGraphqlSoupClient } from '@service-storage/graphql-soup';
import { uploadSlackImport } from '@service-storage/slack-import-upload';
import { type JSX, Show, Suspense } from 'solid-js';
import type { ImportJob } from './context/contracts';
import { ImportProvider } from './context/import-context';
import { hideSlackImportPromotion } from './primitives/promotion';
import {
  createArchiveSource,
  protectImportFile,
} from './queries/archive-source';
import { createImportSource } from './queries/import-source';
import { ImportDialog, type ImportDialogTrigger } from './views/import-dialog';

type Props = {
  teamId: string;
  isAdmin: boolean;
  trigger?: ImportDialogTrigger;
};

export function SlackImport(props: Props): JSX.Element {
  const flag = useFeatureFlag(enableSlackArchiveImport);
  return (
    <Show when={props.isAdmin && flag().enabled}>
      <Show when={props.teamId} keyed>
        {(teamId) => (
          <Suspense
            fallback={
              <IntegrationRow
                icon={<SlackIcon />}
                title="Slack"
                description="Loading Slack import…"
                muted
              />
            }
          >
            <SlackImportSettings teamId={teamId} trigger={props.trigger} />
          </Suspense>
        )}
      </Show>
    </Show>
  );
}

function SlackImportSettings(props: {
  teamId: string;
  trigger?: ImportDialogTrigger;
}): JSX.Element {
  const channels = useListChannelsQuery();
  const userId = useUserId();
  const client = getGraphqlSoupClient();
  const pipedreamEnabled = usePipedreamMcpFlag();
  const { openSettings } = useSettingsState();
  const connectSlack = () => {
    requestConnectApp(SLACK_CONNECT_SLUG, 'import-slack-channels');
    openSettings('Connections');
  };
  function channelHref(id: string): string | undefined {
    if (
      !channels.isSuccess ||
      !channels.data.some((channel) => channel.id === id)
    )
      return undefined;
    return `/app/channel/${encodeURIComponent(id)}`;
  }
  async function onCompleted(job: ImportJob): Promise<void> {
    if (
      job.status === 'completed' ||
      (job.status === 'completed_with_errors' &&
        job.conversations.some(
          (conversation) => conversation.status === 'completed'
        ))
    ) {
      hideSlackImportPromotion(userId(), job.teamId);
    }
    invalidateAllSoup();
    await Promise.all([
      invalidateListChannels(),
      revalidateChannelLists(client),
    ]);
  }
  return (
    <ImportProvider
      context={{
        createSource: (inputs) =>
          createImportSource(
            {
              client: storageServiceClient,
              queryClient,
              gatewayEffect: createConnectionWebsocketEffect,
              upload: uploadSlackImport,
            },
            inputs
          ),
        createArchive: createArchiveSource,
        protectFile: () => protectImportFile(holdAutomaticReload),
        newToken: () => crypto.randomUUID(),
      }}
    >
      <ImportDialog
        teamId={props.teamId}
        trigger={props.trigger}
        onConnect={pipedreamEnabled() ? connectSlack : undefined}
        onCompleted={onCompleted}
        channelHref={channelHref}
      />
    </ImportProvider>
  );
}
