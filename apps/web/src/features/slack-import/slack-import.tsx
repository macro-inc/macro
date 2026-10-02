import { useFeatureFlag } from '@app/lib/analytics/posthog';
import { enableSlackArchiveImport } from '@core/constant/featureFlags';
import { holdAutomaticReload } from '@core/util/reloadForNewerBuild';
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
import { ImportProvider } from './context/import-context';
import {
  createArchiveSource,
  protectImportFile,
} from './queries/archive-source';
import { createImportSource } from './queries/import-source';
import { ImportDialog } from './views/import-dialog';

type Props = { teamId: string; isAdmin: boolean };

export function SlackImport(props: Props): JSX.Element {
  const flag = useFeatureFlag(enableSlackArchiveImport);
  return (
    <Show when={props.isAdmin && flag().enabled}>
      <Show when={props.teamId} keyed>
        {(teamId) => (
          <Suspense
            fallback={
              <p class="text-sm text-ink-muted">Loading Slack import…</p>
            }
          >
            <SlackImportSettings teamId={teamId} />
          </Suspense>
        )}
      </Show>
    </Show>
  );
}

function SlackImportSettings(props: { teamId: string }): JSX.Element {
  const channels = useListChannelsQuery();
  const client = getGraphqlSoupClient();
  function channelHref(id: string): string | undefined {
    if (
      !channels.isSuccess ||
      !channels.data.some((channel) => channel.id === id)
    )
      return undefined;
    return `/app/channel/${encodeURIComponent(id)}`;
  }
  async function onCompleted(): Promise<void> {
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
        onCompleted={onCompleted}
        channelHref={channelHref}
      />
    </ImportProvider>
  );
}
