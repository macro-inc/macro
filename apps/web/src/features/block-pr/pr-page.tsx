import { ListSkeleton } from '@app/components/view-shell/ListSkeleton';
import { createBrowserChangesActions } from '@app/features/changes/browser-host';
import { ChangesProvider } from '@app/features/changes/changes';
import {
  ChatWithAgentIcon,
  openChatWithAgent,
} from '@app/features/chat/ChatWithAgentButton';
import { t } from '@app/lib/i18n';
import { TraceFlow, useFlow, usePending } from '@app/observability/flow';
import { useGlobalNotificationSource } from '@components/app/GlobalAppState';
import { SidePanel } from '@components/app/side-panel';
import { SplitFileMenu } from '@components/app/split-layout/components/SplitFileMenu';
import { useSplitLayout } from '@components/app/split-layout/layout';
import { Permissions } from '@core/component/SharePermissions';
import { isTouchDevice } from '@core/mobile/isTouchDevice';
import { fireAndForget } from '@core/util/fireAndForget';
import { NotificationReadMarker } from '@notifications';
import { type Accessor, Show, Suspense } from 'solid-js';
import { confirmMergePullRequest } from './component/MergePullRequestButton';
import { PrPageProvider } from './context/pr-page-context';
import type { PrForeignEntityData } from './data/queries';
import { usePrShare } from './hooks/usePrShare';
import type { PrActions } from './primitives/create-pr-actions';
import { usePrFileOperations } from './primitives/pr-file-operations';
import { usePrPageContext } from './queries/pr-page-source';
import { PrPageMobile } from './views/mobile/pr-page-mobile';
import { PrPageView } from './views/pr-page-view';
import { PrStateMenu } from './views/shared/pr-state-menu';

function PrFileMenu(props: {
  detail: Accessor<PrForeignEntityData | undefined>;
  actions: PrActions;
}) {
  const operations = usePrFileOperations(props.detail, props.actions);
  const flow = useFlow();
  return (
    <Show when={props.detail()}>
      {(current) => (
        <SplitFileMenu
          id={current().id}
          itemType="foreign"
          name={current().pullRequest.name ?? t('prPage.loading')}
          entityKind="pr"
          permissions={Permissions.CAN_VIEW}
          ops={[
            {
              label: t('entityActions.askMacro'),
              icon: ChatWithAgentIcon,
              action: () =>
                fireAndForget(
                  flow.task('pr.ask-macro', async () => {
                    await openChatWithAgent({
                      type: 'pr',
                      id: current().id,
                      url: current().pullRequest.url,
                    });
                  }),
                  'pr-ask-macro'
                ),
            },
            ...operations(),
          ]}
        />
      )}
    </Show>
  );
}

function PrPageSource(props: { foreignEntityId: string; hosted?: boolean }) {
  const source = usePrPageContext(
    () => props.foreignEntityId,
    confirmMergePullRequest
  );
  const splitLayout = useSplitLayout();
  const notificationSource = useGlobalNotificationSource();
  const { openShare, ShareModal } = usePrShare(
    () => props.foreignEntityId,
    () => source.page()?.pullRequest.name ?? t('prPage.loading')
  );
  usePending('pr.page', () => source.status?.() === 'pending');
  const host = {
    scopeKey: () => `pr:${props.foreignEntityId}`,
    pullRequestUrl: () => source.page()?.pullRequest.url,
    pullRequestTitle: () => source.page()?.pullRequest.name ?? undefined,
    pullRequestChangeCounts: () => {
      const pr = source.page()?.pullRequest;
      if (pr?.additions == null || pr.deletions == null) return undefined;
      return { additions: pr.additions, deletions: pr.deletions };
    },
    ...createBrowserChangesActions(),
  };
  const viewProps = {
    get hosted() {
      return props.hosted;
    },
    share: () => {
      if (source.detail?.()) openShare();
    },
    get shareEnabled() {
      return source.detail?.() !== undefined;
    },
    get shareModal() {
      return (
        <Show when={source.detail?.()}>
          <ShareModal />
        </Show>
      );
    },
    onTask: (id: string, event: MouseEvent) => {
      splitLayout.openWithSplit(
        { type: 'md', id },
        { preferNewSplit: event.shiftKey }
      );
    },
    get fileMenu() {
      return (
        <Show
          fallback={<PrStateMenu />}
          when={
            source.lifecycle &&
            source.detail && {
              actions: source.lifecycle,
              detail: source.detail,
            }
          }
        >
          {(production) => (
            <PrFileMenu
              detail={production().detail}
              actions={production().actions}
            />
          )}
        </Show>
      );
    },
  };
  return (
    <PrPageProvider value={source}>
      <Show when={source.lifecycle}>
        <NotificationReadMarker
          notificationSource={notificationSource}
          entity={{ type: 'foreign_entity', id: props.foreignEntityId }}
        />
      </Show>
      <ChangesProvider context={{ source: source.changesSource, host }}>
        <SidePanel.Root persistKey={`pr:${props.foreignEntityId}`}>
          <Show when={isTouchDevice()} fallback={<PrPageView {...viewProps} />}>
            <PrPageMobile {...viewProps} />
          </Show>
        </SidePanel.Root>
      </ChangesProvider>
    </PrPageProvider>
  );
}

/** Standalone, Reviews-hosted, and legacy block hosts share this production boundary. */
export function PrPage(props: { foreignEntityId: string; hosted?: boolean }) {
  return (
    <Suspense
      fallback={
        <ListSkeleton.Root
          label={t('prPage.loading')}
          class="flex size-full flex-col gap-4 p-6"
        >
          <ListSkeleton.Bar class="h-6 w-3/4" />
          <ListSkeleton.Bar class="w-1/2" />
        </ListSkeleton.Root>
      }
    >
      <TraceFlow
        name="pr.page.view"
        key={() => props.foreignEntityId}
        attributes={{ 'entity.id': props.foreignEntityId }}
      >
        <Show when={props.foreignEntityId} keyed>
          {(id) => <PrPageSource foreignEntityId={id} hosted={props.hosted} />}
        </Show>
      </TraceFlow>
    </Suspense>
  );
}
