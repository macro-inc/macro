import { useSplitLayout } from '@components/app/split-layout/layout';
import { useSettingsState } from '@core/constant/SettingsState';
import { useUserId } from '@core/context/user';
import { usePipedreamMcpFlag } from '@core/pipedream/flag';
import { createUserScopedStorage } from '@core/util/userScopedStorage';
import { useEmailLinksQuery } from '@queries/email/link';
import { useMcpServersQuery } from '@queries/mcp-servers';
import { usePipedreamConnectionsQuery } from '@queries/pipedream-connectors';
import { createMediaQuery } from '@solid-primitives/media';
import { createSignal, Show, Suspense } from 'solid-js';
import { ViewGuideCard } from './components/ViewGuideCard';
import {
  VIEW_GUIDES,
  type ViewGuide,
  type ViewGuideStep,
} from './core/viewGuides';

/** Per-account, per-view dismissal for automatically shown guide flyovers. */
export function ViewGettingStarted(props: {
  view: string;
  onStepChange?: (step: ViewGuideStep) => void;
}) {
  const userId = useUserId();
  const desktop = createMediaQuery('(min-width: 768px) and (pointer: fine)');
  return (
    <Show when={desktop() && VIEW_GUIDES[props.view]} keyed>
      {(guide) => (
        <Show when={userId()} keyed>
          {(id) => (
            <Suspense>
              <ConnectedGuide
                guide={guide}
                userId={id}
                view={props.view}
                onStepChange={props.onStepChange}
              />
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
  onStepChange?: (step: ViewGuideStep) => void;
}) {
  const storage = createUserScopedStorage(
    `macro:setup-suggestion:${props.view}`
  );
  const localTesting =
    import.meta.env.DEV &&
    ['localhost', '127.0.0.1', '[::1]'].includes(window.location.hostname);
  const [dismissed, setDismissed] = createSignal(
    !localTesting && storage.read(props.userId) === 'hidden'
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
      onStepChange={props.onStepChange}
      dismissed={dismissed()}
      connected={connected()}
      onImport={
        props.view === 'tasks'
          ? () => openWithSplit({ type: 'component', id: 'import-linear' })
          : undefined
      }
      onDismiss={() => {
        setDismissed(true);
        if (!localTesting) storage.write(props.userId, 'hidden');
      }}
      onConnect={() =>
        openSettingsInSplit(
          props.guide.connector === 'Google' ? 'Email' : 'Connected'
        )
      }
    />
  );
}
