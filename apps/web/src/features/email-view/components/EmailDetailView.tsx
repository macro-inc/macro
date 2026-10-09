import { EntityDetailBreadcrumbSkeleton } from '@app/components/entity-detail/EntityDetailBreadcrumbSkeleton';
import { useListNavigationHotkeys } from '@app/components/entity-detail/use-list-navigation-hotkeys';
import { ViewBreadcrumbs, ViewShell } from '@app/components/view-shell';
import { displaySubject } from '@app/features/email-compose/core/subject-text';
import type { EmailThreadHost } from '@app/features/email-thread/context/email-thread-context';
import { createEmailThreadSource } from '@app/features/email-thread/queries/thread-source';
import { useBlockEntityCommands } from '@app/features/next-soup/actions';
import { createSearchParams, useRouteParams } from '@app/lib/split-router';
import { emailThreadRoute } from '@app/routes/routes';
import { EmailThreadControls } from '@block-email/component/EmailThreadControls';
import { EmailThreadLoadGate } from '@block-email/component/EmailThreadLoadGate';
import {
  type EmailThreadToolsOptions,
  useEmailThreadTools,
} from '@block-email/component/useEmailThreadTools';
import { EmailThreadHostView } from '@block-email/EmailThreadHostView';
import { registerEmailHotkeys } from '@block-email/util/emailHotkeys';
import { useGlobalNotificationSource } from '@components/app/GlobalAppState';
import { SidePanel } from '@components/app/side-panel';
import { SplitFileMenu } from '@components/app/split-layout/components/SplitFileMenu';
import { ListNavigationButtons } from '@components/app/split-layout/components/SplitHeader';
import {
  useCanAutofocusSplitContent,
  useSplitDisplayName,
  useSplitPanelOrThrow,
} from '@components/app/split-layout/layoutUtils';
import { createSplitAutofocus } from '@components/app/split-layout/utils/createSplitAutofocus';
import { EntityIcon } from '@core/component/EntityIcon';
import { toEntityLoadError } from '@core/component/EntityLoadGate';
import { getPermissions } from '@core/component/SharePermissions';
import { ShareTrigger } from '@core/component/TopBar/ShareButton';
import { useShareModal } from '@core/component/TopBar/shareModal';
import { ENABLE_EMAIL_SHARING } from '@core/constant/featureFlags';
import { TOKENS } from '@core/hotkey/tokens';
import { registerScopeSignalHotkey } from '@core/hotkey/utils';
import { isTouchDevice } from '@core/mobile/isTouchDevice';
import { buildEntityData } from '@entity';
import { useThreadQuery } from '@queries/email/thread';
import { representativeThreadMessage } from '@queries/email/thread-subject';
import { ButtonGroup } from '@ui';
import { createMemo, createSignal, Show } from 'solid-js';
import { Portal } from 'solid-js/web';
import { emailDetailSearch } from '../email-route';
import { useEmailView } from '../email-view-context';
import { createHeldThreadSource } from '../primitives/held-thread-source';
import type { EmailThreadTarget } from '../types';
import { useEmailDetailListNavigation } from '../use-email-detail-list-navigation';

function EmailDetailHeader(
  props: EmailThreadToolsOptions & {
    value: string;
    focusThread: () => void;
    controlsMount: HTMLDivElement | undefined;
    onEmailReminderSaved: () => void | Promise<void>;
  }
) {
  const { emailEntity, permissions, menuTools, controls } =
    useEmailThreadTools(props);
  return (
    <>
      <ViewBreadcrumbs.Item
        value={props.value}
        metadata={{ type: 'email', id: props.id }}
        order={1}
      >
        {(item) => (
          <div class="flex min-w-0 items-center gap-0.5">
            <ViewBreadcrumbs.Button
              class="gap-1.5"
              isActive={item.isActive()}
              onClick={() => {
                item.onSelect();
                props.focusThread();
              }}
              tooltip={props.title}
            >
              <EntityIcon targetType="email" size="xs" class="shrink-0" />
              <span class="truncate">{props.title}</span>
            </ViewBreadcrumbs.Button>
            <div class="shrink-0">
              <SplitFileMenu
                id={props.id}
                itemType="email"
                entityKind="email"
                name={props.title}
                entity={emailEntity()}
                permissions={permissions()}
                ops={[]}
                tools={menuTools}
                onEmailReminderSaved={props.onEmailReminderSaved}
              />
            </div>
          </div>
        )}
      </ViewBreadcrumbs.Item>
      <Show when={props.controlsMount}>
        {(mount) => (
          <Portal mount={mount()}>
            <ButtonGroup variant="outline" size="icon-md" class="touch:hidden">
              <EmailThreadControls {...controls} />
              <Show when={props.listNavigation}>
                {(navigation) => (
                  <ListNavigationButtons
                    navigation={navigation()}
                    class="gap-0"
                  />
                )}
              </Show>
            </ButtonGroup>
          </Portal>
        )}
      </Show>
    </>
  );
}

export function EmailDetailView(props: {
  thread: EmailThreadTarget;
  targetMessageId?: string;
  targetRequest?: string;
}) {
  const { closeThread, selectedThread } = useEmailView();
  const panel = useSplitPanelOrThrow();
  const notificationSource = useGlobalNotificationSource();
  const canAutofocus = useCanAutofocusSplitContent();
  const [controlsMount, setControlsMount] = createSignal<HTMLDivElement>();
  const threadId = () => props.thread.id;
  const threadQuery = useThreadQuery(threadId, () => ({
    enabled: !!threadId(),
  }));
  const listNavigation = useEmailDetailListNavigation(threadId);
  const { held: navigationHeld } = useListNavigationHotkeys({
    scopeId: panel.splitHotkeyScope,
    enabled: () =>
      panel.isPanelActive() && selectedThread()?.id === props.thread.id,
    navigation: listNavigation,
    arrowKeys: true,
  });
  const display = createHeldThreadSource({
    threadId,
    source: createEmailThreadSource(threadId, threadQuery),
    holding: navigationHeld,
  });
  const source = display.source;
  const threadData = source.thread;
  const title = () => {
    const thread = threadData();
    return (
      (thread &&
        displaySubject(
          representativeThreadMessage(thread.messages)?.subject
        )) ||
      props.thread.fallbackName ||
      'Email'
    );
  };
  useSplitDisplayName(title);
  const openShare = useShareModal(() => {
    const thread = threadData();
    if (!thread) return;
    return {
      id: display.threadId(),
      blockAlias: 'email',
      itemType: 'email',
      name: title(),
      userPermissions: getPermissions(thread.access_level),
    };
  });
  const commandEntity = createMemo(() => {
    if (!threadQuery.isSuccess || display.isHeld()) return undefined;
    const thread = threadData();
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
    onEmailReminderSaved: async () => {
      await listNavigation.afterReminderSaved?.();
    },
  });

  let container: HTMLDivElement | undefined;
  const focusContainer = () => container?.focus({ preventScroll: true });
  createSplitAutofocus({
    element: () => container ?? null,
    enabled: () => canAutofocus && panel.isPanelActive() && !isTouchDevice(),
  });
  const hotkeyScope = () => panel.splitHotkeyScope;
  const host: EmailThreadHost = {
    returnToList: closeThread,
    listNavigation,
    focusContainer,
    targetMessageId: () => props.targetMessageId,
    targetRequest: () => props.targetRequest,
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
        description: 'Collapse message or back to list',
        // Escape unwinds thread state first (reply, expanded body, focused
        // message). Once nothing is left to unwind it follows the breadcrumb
        // back to the list this thread was opened from.
        keyDownHandler: () => {
          if (handlers.cancel()) return true;
          closeThread();
          return true;
        },
        hotkeyToken: TOKENS.email.cancelReply,
        hide: true,
      });
    },
  };
  const breadcrumbValue = () => `email-thread:${props.thread.id}`;
  const loadResult = {
    data: threadData,
    error: () =>
      threadQuery.isError && !display.isHeld()
        ? toEntityLoadError(threadQuery.error)
        : undefined,
    isPending: () => threadQuery.isLoading && !display.isHeld(),
  };

  return (
    <SidePanel.Root floating defaultOpen={false}>
      <div class="flex size-full min-h-0 min-w-0 flex-col overflow-hidden">
        <ViewShell.TopBar class="touch:flex">
          <ViewBreadcrumbs.Outlet
            class="flex-1"
            aria-label="Email location"
            fallback={<EntityDetailBreadcrumbSkeleton />}
          />
          <div class="ml-auto flex shrink-0 items-center gap-1 @max-[900px]/split-header:[&_[data-header-action]]:w-8 @max-[900px]/split-header:[&_[data-header-action]]:p-0 @max-[900px]/split-header:[&_[data-header-action-label]]:hidden">
            <div ref={setControlsMount} class="flex items-center" />
            <SidePanel.HeaderActionsOutlet />
            <Show when={ENABLE_EMAIL_SHARING}>
              <ShareTrigger
                onClick={openShare}
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
            threadId={display.threadId()}
            linkId={threadData()?.link_id}
            debounceTime={100}
            onRetry={() => void threadQuery.refetch()}
          >
            {/* A held thread hands over without a loading state in between,
                so remount per thread as the loading state otherwise would. */}
            <Show when={display.threadId()} keyed>
              {(shownId) => (
                <EmailThreadHostView
                  title={title()}
                  threadId={display.threadId}
                  source={source}
                  threadTransport={() => threadQuery.transport}
                  host={host}
                  chrome={({ createTask }) => (
                    <EmailDetailHeader
                      onEmailReminderSaved={async () => {
                        await listNavigation.afterReminderSaved?.();
                      }}
                      id={shownId}
                      title={title()}
                      onCreateTask={createTask}
                      onMarkedUnread={closeThread}
                      onDeleted={closeThread}
                      listNavigation={listNavigation}
                      value={breadcrumbValue()}
                      focusThread={focusContainer}
                      controlsMount={controlsMount()}
                    />
                  )}
                  sidePanelHeaderToggle={false}
                />
              )}
            </Show>
          </EmailThreadLoadGate>
        </div>
      </div>
    </SidePanel.Root>
  );
}

export function EmailDetailRouteView() {
  const params = useRouteParams(emailThreadRoute);
  const [search] = createSearchParams(emailDetailSearch);

  return (
    <EmailDetailView
      thread={{ id: params.threadId }}
      targetMessageId={search.messageId || undefined}
      targetRequest={search.seek}
    />
  );
}
