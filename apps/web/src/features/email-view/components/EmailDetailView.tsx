import { useListNavigationHotkeys } from '@app/components/entity-detail/use-list-navigation-hotkeys';
import { ViewBreadcrumbs, ViewShell } from '@app/components/view-shell';
import { displaySubject } from '@app/features/email-compose/core/subject-text';
import type { EmailThreadHost } from '@app/features/email-thread/context/email-thread-context';
import { createEmailThreadSource } from '@app/features/email-thread/queries/thread-source';
import { useBlockEntityCommands } from '@app/features/next-soup/actions';
import { createSearchParams, useRouteParams } from '@app/lib/split-router';
import { EmailThreadLoadGate } from '@block-email/component/EmailThreadLoadGate';
import { EmailThreadHostView } from '@block-email/EmailThreadHostView';
import { registerEmailHotkeys } from '@block-email/util/emailHotkeys';
import { useGlobalNotificationSource } from '@components/app/GlobalAppState';
import { SidePanel } from '@components/app/side-panel';
import {
  useCanAutofocusSplitContent,
  useSplitPanelOrThrow,
} from '@components/app/split-layout/layoutUtils';
import { EntityIcon } from '@core/component/EntityIcon';
import { toEntityLoadError } from '@core/component/EntityLoadGate';
import {
  ShareDialogContext,
  ShareTrigger,
} from '@core/component/TopBar/ShareButton';
import { ENABLE_EMAIL_SHARING } from '@core/constant/featureFlags';
import { TOKENS } from '@core/hotkey/tokens';
import { registerScopeSignalHotkey } from '@core/hotkey/utils';
import { isTouchDevice } from '@core/mobile/isTouchDevice';
import { buildEntityData } from '@entity';
import { useThreadQuery } from '@queries/email/thread';
import { representativeThreadMessage } from '@queries/email/thread-subject';
import { createEffect, createMemo, createSignal, Show } from 'solid-js';
import { emailDetailSearch } from '../email-route';
import { useEmailView } from '../email-view-context';
import { emailThreadRoute } from '../route';
import type { EmailThreadTarget } from '../types';
import { useEmailDetailListNavigation } from '../use-email-detail-list-navigation';

function EmailThreadBreadcrumb(props: {
  value: string;
  title: string;
  threadId: string;
  focusThread: () => void;
}) {
  return (
    <ViewBreadcrumbs.Item
      value={props.value}
      metadata={{ type: 'email', id: props.threadId }}
      order={1}
    >
      {(item) => (
        <ViewBreadcrumbs.Button
          class="gap-1.5"
          isActive={item.isActive()}
          onClick={() => {
            item.onSelect();
            props.focusThread();
          }}
        >
          <EntityIcon targetType="email" size="xs" class="shrink-0" />
          <span class="truncate">{props.title}</span>
        </ViewBreadcrumbs.Button>
      )}
    </ViewBreadcrumbs.Item>
  );
}

export function EmailDetailView(props: {
  thread: EmailThreadTarget;
  targetMessageId?: string;
}) {
  const { closeThread, selectedThread } = useEmailView();
  const panel = useSplitPanelOrThrow();
  const notificationSource = useGlobalNotificationSource();
  const canAutofocus = useCanAutofocusSplitContent();
  const [shareOpen, setShareOpen] = createSignal(false);
  const threadId = () => props.thread.id;
  const threadQuery = useThreadQuery(threadId, () => ({
    enabled: !!threadId(),
  }));
  const source = createEmailThreadSource(threadId, threadQuery);
  const threadData = createMemo(
    (previous: typeof threadQuery.data | undefined) =>
      threadQuery.isSuccess || threadQuery.isError ? threadQuery.data : previous
  );
  const title = () => {
    const thread = threadData()?.thread;
    return (
      (thread &&
        displaySubject(
          representativeThreadMessage(thread.messages)?.subject
        )) ||
      props.thread.fallbackName ||
      'Email'
    );
  };
  const commandEntity = createMemo(() => {
    if (!threadQuery.isSuccess) return undefined;
    const thread = threadQuery.data?.thread;
    if (!thread) return undefined;
    return buildEntityData({
      id: thread.db_id,
      name: displaySubject(
        representativeThreadMessage(thread.messages)?.subject
      ),
      blockName: 'email',
      isRead: thread.is_read,
      done: !thread.inbox_visible,
    });
  });
  useBlockEntityCommands({
    id: props.thread.id,
    scopeId: panel.splitHotkeyScope,
    resolveEntity: commandEntity,
    onDeleted: closeThread,
  });

  let container: HTMLDivElement | undefined;
  const focusContainer = () => container?.focus({ preventScroll: true });
  let focused = false;
  createEffect(() => {
    if (focused || !canAutofocus || isTouchDevice() || !container) return;
    focusContainer();
    focused = true;
  });
  const listNavigation = useEmailDetailListNavigation(threadId);
  const hotkeyScope = () => panel.splitHotkeyScope;
  const host: EmailThreadHost = {
    listNavigation,
    focusContainer,
    targetMessageId: () => props.targetMessageId,
    isActive: panel.isPanelActive,
    registerKeyboard: (handlers) => {
      registerEmailHotkeys(hotkeyScope(), handlers);
      registerScopeSignalHotkey(hotkeyScope, {
        hotkey: 'enter',
        description: 'Reply to message',
        keyDownHandler: handlers.activate,
        hotkeyToken: TOKENS.block.focus,
        hide: true,
      });
      registerScopeSignalHotkey(hotkeyScope, {
        hotkey: 'escape',
        description: 'Collapse or unselect message',
        keyDownHandler: handlers.cancel,
        hotkeyToken: TOKENS.email.cancelReply,
        hide: true,
      });
    },
  };
  const breadcrumbValue = () => `email-thread:${props.thread.id}`;
  useListNavigationHotkeys({
    scopeId: panel.splitHotkeyScope,
    enabled: () =>
      panel.isPanelActive() && selectedThread()?.id === props.thread.id,
    navigation: listNavigation,
  });
  const loadResult = {
    data: threadData,
    error: () =>
      threadQuery.isError ? toEntityLoadError(threadQuery.error) : undefined,
    isPending: () => threadQuery.isLoading,
  };

  return (
    <ShareDialogContext.Provider
      value={{
        isOpen: shareOpen,
        open: () => setShareOpen(true),
        close: () => setShareOpen(false),
      }}
    >
      <EmailThreadBreadcrumb
        value={breadcrumbValue()}
        title={title()}
        threadId={props.thread.id}
        focusThread={focusContainer}
      />
      <SidePanel.Root defaultOpen={false}>
        <div class="flex size-full min-h-0 min-w-0 flex-col overflow-hidden">
          <ViewShell.TopBar class="touch:flex">
            <ViewBreadcrumbs.Outlet
              class="flex-1"
              aria-label="Email location"
            />
            <div class="ml-auto flex shrink-0 items-center gap-2">
              <Show when={ENABLE_EMAIL_SHARING}>
                <ShareTrigger
                  id={props.thread.id}
                  blockType="email"
                  hotkeyScope={panel.splitHotkeyScope}
                />
              </Show>
              <SidePanel.Toggle />
            </div>
          </ViewShell.TopBar>
          <div
            ref={container}
            class="relative min-h-0 min-w-0 flex-1"
            tabIndex={-1}
          >
            <EmailThreadLoadGate
              result={loadResult}
              notificationSource={notificationSource}
              threadId={props.thread.id}
              linkId={threadData()?.thread?.link_id}
              debounceTime={100}
              onRetry={() => void threadQuery.refetch()}
            >
              <EmailThreadHostView
                title={title()}
                threadId={threadId}
                source={source}
                threadTransport={() => threadQuery.transport}
                host={host}
                sidePanelHeaderToggle={false}
                shareOpen={shareOpen()}
                onShareOpenChange={setShareOpen}
              />
            </EmailThreadLoadGate>
          </div>
        </div>
      </SidePanel.Root>
    </ShareDialogContext.Provider>
  );
}

export function EmailDetailRouteView() {
  const params = useRouteParams(emailThreadRoute);
  const [search] = createSearchParams(emailDetailSearch);

  return (
    <EmailDetailView
      thread={{ id: params.threadId }}
      targetMessageId={search.messageId || undefined}
    />
  );
}
