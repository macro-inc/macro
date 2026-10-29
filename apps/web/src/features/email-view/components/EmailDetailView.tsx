import { useListNavigationHotkeys } from '@app/components/entity-detail/use-list-navigation-hotkeys';
import { ViewShell } from '@app/components/view-shell';
import { displaySubject } from '@app/features/email-compose/core/subject-text';
import type {
  EmailThreadHost,
  EmailThreadListNavigation,
} from '@app/features/email-thread/context/email-thread-context';
import {
  delegateThreadKeyboard,
  type EmailThreadKeyboardHandlers,
} from '@app/features/email-thread/core/thread-keyboard';
import { createEmailThreadSource } from '@app/features/email-thread/queries/thread-source';
import { useBlockEntityCommands } from '@app/features/next-soup/actions';
import { createSearchParams, useRouteParams } from '@app/lib/split-router';
import { emailThreadRoute } from '@app/routes/routes';
import {
  EmailThreadControlGroups,
  EmailThreadHeaderActions,
} from '@block-email/component/EmailThreadHeaderActions';
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
import {
  useCanAutofocusSplitContent,
  useSplitDisplayName,
  useSplitPanelOrThrow,
} from '@components/app/split-layout/layoutUtils';
import { createSplitAutofocus } from '@components/app/split-layout/utils/createSplitAutofocus';
import { toEntityLoadError } from '@core/component/EntityLoadGate';
import { getPermissions } from '@core/component/SharePermissions';
import { ShareTrigger } from '@core/component/TopBar/ShareButton';
import { useShareModal } from '@core/component/TopBar/shareModal';
import { ENABLE_EMAIL_SHARING } from '@core/constant/featureFlags';
import { registerHotkey } from '@core/hotkey/hotkeys';
import { TOKENS } from '@core/hotkey/tokens';
import { isTouchDevice } from '@core/mobile/isTouchDevice';
import { fireAndForget } from '@core/util/fireAndForget';
import { buildEntityData, type EntityData } from '@entity';
import ArrowLeftIcon from '@phosphor/arrow-left.svg';
import { useThreadQuery } from '@queries/email/thread';
import { representativeThreadMessage } from '@queries/email/thread-subject';
import { Button, cn } from '@ui';
import {
  type Accessor,
  createEffect,
  createMemo,
  createSignal,
  For,
  onCleanup,
  onMount,
  Show,
} from 'solid-js';
import { Portal } from 'solid-js/web';
import { emailDetailSearch } from '../email-route';
import { useEmailView } from '../email-view-context';
import {
  type BufferedThreadView,
  createBufferedThread,
} from '../primitives/buffered-thread';
import { useEmailReaderPane } from '../reader-pane';
import type { EmailThreadTarget } from '../types';
import { useEmailDetailListNavigation } from '../use-email-detail-list-navigation';

/**
 * Where the title menu sits after the subject's last word. It unsets itself on
 * unmount so a standalone draft, which has no subject line, gets the menu in
 * the header instead.
 */
function TitleMenuMount(props: {
  ref: (element: HTMLElement | undefined) => void;
}) {
  onCleanup(() => props.ref(undefined));
  return <span ref={props.ref} class="ml-1.5 inline-flex align-middle" />;
}

/** The thread's title menu and header controls, which need the loaded thread. */
function EmailDetailHeader(
  props: EmailThreadToolsOptions & {
    titleMenuMount: HTMLElement | undefined;
    controlsMount: HTMLDivElement | undefined;
    onEmailReminderSaved: () => void | Promise<void>;
  }
) {
  const { emailEntity, permissions, menuTools, controls } =
    useEmailThreadTools(props);
  return (
    <>
      <Show when={props.titleMenuMount} keyed>
        {(mount) => (
          <Portal mount={mount} ref={(div) => (div.style.display = 'contents')}>
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
          </Portal>
        )}
      </Show>
      <Show when={props.controlsMount}>
        {(mount) => (
          <Portal mount={mount()}>
            <EmailThreadControlGroups
              controls={controls}
              navigation={props.listNavigation}
            />
          </Portal>
        )}
      </Show>
    </>
  );
}

/**
 * Tells its parent when the content beside it is in the DOM. Effects under a
 * suspended load gate wait for it to resolve, so `onMount` runs only once the
 * content is inserted.
 */
function OnContentMount(props: { set: (mounted: boolean) => void }) {
  onMount(() => props.set(true));
  onCleanup(() => props.set(false));
  return null;
}

/** What a mounted thread hands the route, which acts on the one on screen. */
type EmailThreadView = BufferedThreadView & {
  title: Accessor<string>;
  entity: Accessor<EntityData | undefined>;
  keyboard: Accessor<EmailThreadKeyboardHandlers | undefined>;
};

/**
 * One thread in the reader. It may be loading hidden behind the thread on
 * screen; until it is shown it does not mark itself read or render its
 * header, and its side panel leaves `]` to the shown thread's.
 */
function EmailDetailView(props: {
  thread: EmailThreadTarget;
  targetMessageId?: string;
  targetRequest?: string;
  shown: boolean;
  listNavigation: EmailThreadListNavigation;
  focusReader: () => void;
  attach: (view: EmailThreadView) => void;
}) {
  const { closeThread } = useEmailView();
  const panel = useSplitPanelOrThrow();
  const pane = useEmailReaderPane();
  const keyScope = pane?.hotkeyScope ?? panel.splitHotkeyScope;
  const notificationSource = useGlobalNotificationSource();
  const [controlsMount, setControlsMount] = createSignal<HTMLDivElement>();
  const [subjectMenuMount, setSubjectMenuMount] = createSignal<HTMLElement>();
  const [headerMenuMount, setHeaderMenuMount] = createSignal<HTMLElement>();
  const [keyboard, setKeyboard] = createSignal<EmailThreadKeyboardHandlers>();
  const threadId = () => props.thread.id;
  const threadQuery = useThreadQuery(threadId, () => ({
    enabled: !!threadId(),
  }));
  const source = createEmailThreadSource(threadId, threadQuery);
  const threadData = source.thread;
  const title = () => {
    const thread = threadData();
    return (
      (thread &&
        displaySubject(
          representativeThreadMessage(thread.messages)?.subject
        )) ||
      (props.thread.fallbackName &&
        displaySubject(props.thread.fallbackName)) ||
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
  const [contentMounted, setContentMounted] = createSignal(false);
  // The load gate shows data over an error. With data, the content can still
  // suspend for a moment; it has rendered once it is in the DOM.
  props.attach({
    state: () => {
      if (threadData() !== undefined)
        return contentMounted() ? 'rendered' : 'loading';
      return threadQuery.isError ? 'failed' : 'loading';
    },
    title,
    entity: commandEntity,
    keyboard,
  });
  const host: EmailThreadHost = {
    returnToList: closeThread,
    listNavigation: props.listNavigation,
    focusContainer: props.focusReader,
    targetMessageId: () => props.targetMessageId,
    targetRequest: () => props.targetRequest,
    isActive: panel.isPanelActive,
    registerKeyboard: (handlers) => {
      setKeyboard(() => handlers);
      // The thread content can unmount (loading, error) before this view.
      onCleanup(() =>
        setKeyboard((current) => (current === handlers ? undefined : current))
      );
    },
  };
  const loadResult = {
    data: threadData,
    error: () =>
      threadQuery.isError ? toEntityLoadError(threadQuery.error) : undefined,
    isPending: () => threadQuery.isLoading,
  };

  return (
    <SidePanel.Root floating defaultOpen={false} keyboard={props.shown}>
      <div class="flex size-full min-h-0 min-w-0 flex-col overflow-hidden">
        <ViewShell.TopBar class="touch:flex">
          {/* The subject sits atop the thread, so the header only goes
              back; the reading pane already shows the list beside it. */}
          <Show when={!pane}>
            <Button
              variant="ghost"
              size="icon-md"
              tooltip="Back"
              aria-label="Back"
              onClick={closeThread}
            >
              <ArrowLeftIcon class="size-4 touch:size-6" />
            </Button>
          </Show>
          <div ref={setHeaderMenuMount} class="flex items-center" />
          <EmailThreadHeaderActions
            controls={<div ref={setControlsMount} class="flex items-center" />}
            share={
              <Show when={ENABLE_EMAIL_SHARING && props.shown}>
                <ShareTrigger
                  size="md"
                  onClick={openShare}
                  id={props.thread.id}
                  blockType="email"
                  hotkeyScope={keyScope}
                />
              </Show>
            }
          />
        </ViewShell.TopBar>
        <div class="relative min-h-0 min-w-0 flex-1">
          <EmailThreadLoadGate
            isLocalDraft={source.isLocalDraft()}
            result={loadResult}
            notificationSource={notificationSource}
            threadId={props.thread.id}
            linkId={threadData()?.link_id}
            markRead={props.shown}
            debounceTime={100}
            onRetry={() => fireAndForget(threadQuery.refetch(), 'email-view')}
          >
            <EmailThreadHostView
              title={title()}
              titleTrailing={<TitleMenuMount ref={setSubjectMenuMount} />}
              threadId={threadId}
              source={source}
              threadTransport={() => threadQuery.transport}
              host={host}
              chrome={({ createTask }) => (
                <Show when={props.shown}>
                  <EmailDetailHeader
                    onEmailReminderSaved={async () => {
                      await props.listNavigation.afterReminderSaved?.();
                    }}
                    id={props.thread.id}
                    title={title()}
                    onCreateTask={createTask}
                    onMarkedUnread={closeThread}
                    onDeleted={closeThread}
                    listNavigation={props.listNavigation}
                    titleMenuMount={subjectMenuMount() ?? headerMenuMount()}
                    controlsMount={controlsMount()}
                  />
                </Show>
              )}
              sidePanelHeaderToggle={false}
            />
            <OnContentMount set={setContentMounted} />
          </EmailThreadLoadGate>
        </div>
      </div>
    </SidePanel.Root>
  );
}

/**
 * Keeps the open thread on screen while the next one loads behind it, so
 * stepping through threads never flashes an empty reader. The incoming thread
 * renders hidden and inert, and replaces the current one once it has loaded
 * or failed, or after a deadline with its own loading state.
 *
 * Whatever acts on what the user sees is set up here once and follows the
 * thread on screen: its keys, the split's name and focus. A swap re-registers
 * nothing, and focus on the reader survives it.
 */
export function EmailDetailRouteView() {
  const params = useRouteParams(emailThreadRoute);
  const [search] = createSearchParams(emailDetailSearch);
  const { closeThread } = useEmailView();
  const panel = useSplitPanelOrThrow();
  // In the reading pane the thread keeps its keys in the reader's scope, and
  // Escape hands the keyboard back to the list instead of closing it.
  const pane = useEmailReaderPane();
  const keyScope = pane?.hotkeyScope ?? panel.splitHotkeyScope;
  const canAutofocus = useCanAutofocusSplitContent();
  const buffer = createBufferedThread<EmailThreadView>(() => params.threadId);
  // Steps from the latest request, so presses made while a thread loads
  // behind the current one are not lost. It outlives each thread, so Undo
  // after Mark done can still step back to the archived one.
  const listNavigation = useEmailDetailListNavigation(() => params.threadId);
  // While the next thread loads, the one on screen holds its actions: the
  // user has moved on, so `e` must not archive the thread they left.
  const ready = () => !buffer.switching();
  const keyboard = delegateThreadKeyboard(
    () => buffer.current()?.keyboard(),
    ready
  );

  useSplitDisplayName(() => buffer.current()?.title());
  useBlockEntityCommands({
    id: buffer.shown,
    scopeId: keyScope,
    resolveEntity: () => (ready() ? buffer.current()?.entity() : undefined),
    onDeleted: closeThread,
    onEmailReminderSaved: async () => {
      await listNavigation.afterReminderSaved?.();
    },
    extraFavoriteHotkey: { hotkey: 's', hotkeyToken: TOKENS.email.star },
    extraMuteHotkey: { hotkey: 'shift+m', hotkeyToken: TOKENS.email.mute },
  });
  useListNavigationHotkeys({
    scopeId: keyScope,
    enabled: panel.isPanelActive,
    navigation: listNavigation,
    arrowKeys: true,
  });
  // After the block commands, which register in an effect: the thread keys
  // take r, e and Enter from them.
  onMount(() => {
    registerEmailHotkeys(keyScope, keyboard);
    registerHotkey({
      hotkey: 'enter',
      scopeId: keyScope,
      description: 'Reply to message',
      keyDownHandler: keyboard.activate,
      hotkeyToken: TOKENS.block.focus,
      hide: true,
    });
    registerHotkey({
      hotkey: 'escape',
      scopeId: keyScope,
      description: 'Collapse message or back to list',
      // Escape unwinds thread state first (reply, expanded body, focused
      // message). Once nothing is left to unwind it goes back to the list
      // this thread was opened from.
      keyDownHandler: () => {
        if (keyboard.cancel()) return true;
        (pane?.focusList ?? closeThread)();
        return true;
      },
      hotkeyToken: TOKENS.email.cancelReply,
      hide: true,
    });
  });

  let reader: HTMLDivElement | undefined;
  const focusReader = () => reader?.focus({ preventScroll: true });
  createSplitAutofocus({
    element: () => reader ?? null,
    enabled: () => canAutofocus && panel.isPanelActive() && !isTouchDevice(),
  });
  createEffect(() => {
    if (!pane || pane.focusRequest() !== buffer.shown()) return;
    pane.clearFocusRequest();
    focusReader();
  });

  return (
    <div ref={reader} class="relative size-full min-h-0 min-w-0" tabIndex={-1}>
      <For each={buffer.mounted()}>
        {(threadId) => {
          let slot: HTMLDivElement | undefined;
          const shown = () => buffer.shown() === threadId;
          // A message target belongs to the thread it was requested for.
          const targetMessageId = createMemo<string | undefined>((previous) =>
            params.threadId === threadId
              ? search.messageId || undefined
              : previous
          );
          const targetRequest = createMemo<string | undefined>((previous) =>
            params.threadId === threadId ? search.seek : previous
          );
          // Removing the thread that holds focus would drop it to the body.
          onCleanup(() => {
            if (slot?.contains(document.activeElement)) focusReader();
          });
          return (
            <div
              ref={slot}
              class={cn(
                'size-full min-h-0 min-w-0',
                !shown() && 'invisible absolute inset-0'
              )}
              inert={!shown()}
              aria-hidden={!shown()}
            >
              <EmailDetailView
                thread={{ id: threadId }}
                targetMessageId={targetMessageId()}
                targetRequest={targetRequest()}
                shown={shown()}
                listNavigation={listNavigation}
                focusReader={focusReader}
                attach={(view) => buffer.attach(threadId, view)}
              />
            </div>
          );
        }}
      </For>
    </div>
  );
}
