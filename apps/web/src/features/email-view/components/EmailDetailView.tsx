import { EntityDetailBreadcrumbSkeleton } from '@app/components/entity-detail/EntityDetailBreadcrumbSkeleton';
import { useListNavigationHotkeys } from '@app/components/entity-detail/use-list-navigation-hotkeys';
import { ViewBreadcrumbs, ViewShell } from '@app/components/view-shell';
import { displaySubject } from '@app/features/email-compose/core/subject-text';
import type {
  EmailThreadHost,
  EmailThreadListNavigation,
} from '@app/features/email-thread/context/email-thread-context';
import type { EmailThreadKeyboardHandlers } from '@app/features/email-thread/core/thread-keyboard';
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
import { buildEntityData, type EntityData } from '@entity';
import { useThreadQuery } from '@queries/email/thread';
import { representativeThreadMessage } from '@queries/email/thread-subject';
import { ButtonGroup, cn } from '@ui';
import {
  type Accessor,
  createEffect,
  createMemo,
  createSignal,
  For,
  on,
  Show,
} from 'solid-js';
import { Portal } from 'solid-js/web';
import { emailDetailSearch } from '../email-route';
import { useEmailView } from '../email-view-context';
import { createBufferedThread } from '../primitives/buffered-thread';
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

/** How a buffered thread knows whether it is the one on screen. */
export type EmailDetailPresentation = {
  /** False while this thread loads behind the one on screen. */
  active: Accessor<boolean>;
  /** Called once the thread has rendered its messages or failed to load. */
  onSettled: () => void;
};

/**
 * Bindings that act on what the user sees, so only the active thread has them.
 * Thread keys register last: they take r, e and Enter from the block commands.
 */
function ActiveThreadBindings(props: {
  id: string;
  title: Accessor<string>;
  resolveEntity: Accessor<EntityData | undefined>;
  listNavigation: EmailThreadListNavigation;
  keyboard: Accessor<EmailThreadKeyboardHandlers | undefined>;
  onDeleted: () => void;
  onClose: () => void;
}) {
  const panel = useSplitPanelOrThrow();
  const hotkeyScope = () => panel.splitHotkeyScope;
  useSplitDisplayName(props.title);
  useBlockEntityCommands({
    id: props.id,
    scopeId: panel.splitHotkeyScope,
    resolveEntity: props.resolveEntity,
    onDeleted: props.onDeleted,
    onEmailReminderSaved: async () => {
      await props.listNavigation.afterReminderSaved?.();
    },
    favoriteHotkeys: ['s', 'opt+f'],
  });
  useListNavigationHotkeys({
    scopeId: panel.splitHotkeyScope,
    enabled: panel.isPanelActive,
    navigation: props.listNavigation,
    arrowKeys: true,
  });
  createEffect(() => {
    const handlers = props.keyboard();
    if (!handlers) return;
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
        props.onClose();
        return true;
      },
      hotkeyToken: TOKENS.email.cancelReply,
      hide: true,
    });
  });
  return null;
}

export function EmailDetailView(props: {
  thread: EmailThreadTarget;
  targetMessageId?: string;
  targetRequest?: string;
  presentation?: EmailDetailPresentation;
  /** Shared list navigation that steps from the latest requested thread. */
  listNavigation?: EmailThreadListNavigation;
}) {
  const active = () => props.presentation?.active() ?? true;
  const [keyboard, setKeyboard] = createSignal<EmailThreadKeyboardHandlers>();
  const { closeThread, source: listSource, warmThreads } = useEmailView();
  const panel = useSplitPanelOrThrow();
  const notificationSource = useGlobalNotificationSource();
  const canAutofocus = useCanAutofocusSplitContent();
  const [controlsMount, setControlsMount] = createSignal<HTMLDivElement>();
  const threadId = () => props.thread.id;
  const threadQuery = useThreadQuery(threadId, () => ({
    enabled: !!threadId(),
  }));
  const source = createEmailThreadSource(threadId, threadQuery);
  // Once this thread has loaded, its neighbours are the likeliest next opens
  // (j/k, Mark done): load them so stepping reads them from cache.
  createEffect(() => {
    if (!threadQuery.isSuccess) return;
    const ids = listSource
      .items()
      .flatMap((row) =>
        row.kind === 'entity' && row.entity.type === 'email'
          ? [row.entity.id]
          : []
      );
    const index = ids.indexOf(threadId());
    if (index < 0) return;
    warmThreads(
      [ids[index + 1], ids[index - 1], ids[index + 2]].filter(
        (id): id is string => id !== undefined
      )
    );
  });
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
  const openShare = useShareModal(() => {
    const thread = threadData();
    if (!thread) return;
    return {
      id: props.thread.id,
      blockAlias: 'email',
      itemType: 'email',
      name: title(),
      userPermissions: getPermissions(thread.access_level),
    };
  });
  const commandEntity = createMemo(() => {
    if (!threadQuery.isSuccess) return undefined;
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
  let container: HTMLDivElement | undefined;
  const focusContainer = () => container?.focus({ preventScroll: true });
  createSplitAutofocus({
    element: () => container ?? null,
    enabled: () =>
      active() && canAutofocus && panel.isPanelActive() && !isTouchDevice(),
  });
  // A thread that loaded behind the previous one takes over its focus, which
  // went to the body when the previous thread unmounted.
  createEffect(
    on(
      active,
      (isActive) => {
        if (!isActive || !panel.isPanelActive()) return;
        const focused = document.activeElement;
        if (!focused || focused === document.body) focusContainer();
      },
      { defer: true }
    )
  );
  createEffect(() => {
    if (threadData() === undefined && !threadQuery.isError) return;
    // After this flush, so the messages are in the DOM when it is revealed.
    queueMicrotask(() => props.presentation?.onSettled());
  });
  // The route's navigation outlives this thread, so Undo after Mark done can
  // still step back to it.
  const listNavigation =
    props.listNavigation ?? useEmailDetailListNavigation(threadId);
  const host: EmailThreadHost = {
    returnToList: closeThread,
    listNavigation,
    focusContainer,
    targetMessageId: () => props.targetMessageId,
    targetRequest: () => props.targetRequest,
    isActive: panel.isPanelActive,
    registerKeyboard: setKeyboard,
  };
  const breadcrumbValue = () => `email-thread:${props.thread.id}`;
  const loadResult = {
    data: threadData,
    error: () =>
      threadQuery.isError ? toEntityLoadError(threadQuery.error) : undefined,
    isPending: () => threadQuery.isLoading,
  };

  return (
    <SidePanel.Root floating defaultOpen={false}>
      <Show when={active()}>
        <ActiveThreadBindings
          id={props.thread.id}
          title={title}
          resolveEntity={commandEntity}
          listNavigation={listNavigation}
          keyboard={keyboard}
          onDeleted={closeThread}
          onClose={closeThread}
        />
      </Show>
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
            <Show when={ENABLE_EMAIL_SHARING && active()}>
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
            threadId={props.thread.id}
            linkId={threadData()?.link_id}
            markRead={active()}
            debounceTime={100}
            onRetry={() => void threadQuery.refetch()}
          >
            <EmailThreadHostView
              title={title()}
              threadId={threadId}
              source={source}
              threadTransport={() => threadQuery.transport}
              host={host}
              chrome={({ createTask }) => (
                <Show when={active()}>
                  <EmailDetailHeader
                    onEmailReminderSaved={async () => {
                      await listNavigation.afterReminderSaved?.();
                    }}
                    id={props.thread.id}
                    title={title()}
                    onCreateTask={createTask}
                    onMarkedUnread={closeThread}
                    onDeleted={closeThread}
                    listNavigation={listNavigation}
                    value={breadcrumbValue()}
                    focusThread={focusContainer}
                    controlsMount={controlsMount()}
                  />
                </Show>
              )}
              sidePanelHeaderToggle={false}
            />
          </EmailThreadLoadGate>
        </div>
      </div>
    </SidePanel.Root>
  );
}

/**
 * Keeps the open thread on screen while the next one loads behind it, so
 * stepping through threads never flashes an empty reader. The incoming thread
 * renders hidden and inert, then replaces the current one once its messages
 * are in the DOM, or after a deadline, showing its own loading state.
 */
export function EmailDetailRouteView() {
  const params = useRouteParams(emailThreadRoute);
  const [search] = createSearchParams(emailDetailSearch);
  const buffer = createBufferedThread(() => params.threadId);
  // Each j/k steps from the latest requested thread, so presses made while a
  // thread loads behind the current one are not lost.
  const listNavigation = useEmailDetailListNavigation(() => params.threadId);

  return (
    <div class="relative size-full min-h-0 min-w-0">
      <For each={buffer.mounted()}>
        {(threadId) => {
          const isShown = () => buffer.shown() === threadId;
          // A message target belongs to the thread it was requested for.
          const targetMessageId = createMemo<string | undefined>((previous) =>
            params.threadId === threadId
              ? search.messageId || undefined
              : previous
          );
          const targetRequest = createMemo<string | undefined>((previous) =>
            params.threadId === threadId ? search.seek : previous
          );
          return (
            <div
              class={cn(
                'size-full min-h-0 min-w-0',
                !isShown() && 'invisible absolute inset-0'
              )}
              inert={!isShown()}
              aria-hidden={!isShown()}
            >
              <EmailDetailView
                thread={{ id: threadId }}
                targetMessageId={targetMessageId()}
                targetRequest={targetRequest()}
                presentation={{
                  active: isShown,
                  onSettled: () => buffer.settle(threadId),
                }}
                listNavigation={listNavigation}
              />
            </div>
          );
        }}
      </For>
    </div>
  );
}
