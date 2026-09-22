import { useSplitLayout } from '@components/app/split-layout/layout';
import { useSettingsState } from '@core/constant/SettingsState';
import { useUserId } from '@core/context/user';
import { usePipedreamMcpFlag } from '@core/pipedream/flag';
import { createUserScopedStorage } from '@core/util/userScopedStorage';
import { useEmailLinksQuery } from '@queries/email/link';
import { useMcpServersQuery } from '@queries/mcp-servers';
import { usePipedreamConnectionsQuery } from '@queries/pipedream-connectors';
import { createSignal, Show, Suspense } from 'solid-js';
import { ViewGuideCard } from './components/ViewGuideCard';
import { VIEW_GUIDES, type ViewGuide } from './core/viewGuides';

/** App wiring for the small, replayable guide attached to each list view. */
export function ViewGettingStarted(props: { view: string }) {
  const userId = useUserId();
  return (
    <Show when={VIEW_GUIDES[props.view]}>
      {(guide) => (
        <Show when={userId()} keyed>
          {(id) => (
            <Suspense>
              <ConnectedGuide guide={guide()} userId={id} view={props.view} />
            </Suspense>
          )}
        </Show>
      )}
    </Show>
  );
}

function ConnectedGuide(props: {
  guide: ViewGuide;
  userId: string;
  view: string;
}) {
  const storage = createUserScopedStorage(
    `macro:setup-suggestion:${props.view}`
  );
  const [dismissed, setDismissed] = createSignal(
    storage.read(props.userId) === 'hidden'
  );
  const { openWithSplit } = useSplitLayout();
  const { openSettingsInSplit } = useSettingsState();
  const pipedreamEnabled = usePipedreamMcpFlag();
  const native = useMcpServersQuery({ neverSuspend: true });
  const pipedream = usePipedreamConnectionsQuery({ neverSuspend: true });
  const email = useEmailLinksQuery();
  const connected = () => {
    if (props.guide.connector === 'Google')
      return !email.isSuccess || (email.data?.links.length ?? 0) > 0;
    const names = props.guide.connector?.toLowerCase().split(' or ') ?? [];
    if (pipedreamEnabled()) {
      if (pipedream.isPlaceholderData || !pipedream.isSuccess) return true;
      return (pipedream.data ?? []).some((server) =>
        names.includes(server.app_slug.toLowerCase())
      );
    }
    if (native.isPlaceholderData || !native.isSuccess) return true;
    return (native.data ?? []).some(
      (server) =>
        server.authenticated && names.includes(server.server_name.toLowerCase())
    );
  };
  return (
    <ViewGuideCard
      guide={props.guide}
      dismissed={dismissed()}
      connected={connected()}
      onImport={
        props.view === 'tasks'
          ? () => openWithSplit({ type: 'component', id: 'import-linear' })
          : undefined
      }
      onDismiss={() => {
        setDismissed(true);
        storage.write(props.userId, 'hidden');
      }}
      onConnect={() =>
        openSettingsInSplit(
          props.guide.connector === 'Google' ? 'Email' : 'Connected'
        )
      }
    />
  );
}
