import { useListNavigationHotkeys } from '@app/components/entity-detail/use-list-navigation-hotkeys';
import { displaySubject } from '@app/features/email-compose/core/subject-text';
import type { EmailThreadHost } from '@app/features/email-thread/context/email-thread-context';
import { createEmailThreadSource } from '@app/features/email-thread/queries/thread-source';
import { useBlockEntityCommands } from '@app/features/next-soup/actions';
import { createSearchParams, useRouteParams } from '@app/lib/split-router';
import { usePending } from '@app/observability/flow';
import { emailThreadRoute } from '@app/routes/routes';
import { EmailThreadLoadGate } from '@block-email/component/EmailThreadLoadGate';
import { registerEmailHotkeys } from '@block-email/util/emailHotkeys';
import { useGlobalNotificationSource } from '@components/app/GlobalAppState';
import { SidePanel } from '@components/app/side-panel';
import {
  useCanAutofocusSplitContent,
  useSplitDisplayName,
  useSplitPanelOrThrow,
} from '@components/app/split-layout/layoutUtils';
import { createSplitAutofocus } from '@components/app/split-layout/utils/createSplitAutofocus';
import { toEntityLoadError } from '@core/component/EntityLoadGate';
import { TOKENS } from '@core/hotkey/tokens';
import { registerScopeSignalHotkey } from '@core/hotkey/utils';
import { isTouchDevice } from '@core/mobile/isTouchDevice';
import { fireAndForget } from '@core/util/fireAndForget';
import { buildEntityData } from '@entity';
import { useThreadQuery } from '@queries/email/thread';
import { representativeThreadMessage } from '@queries/email/thread-subject';
import { createEffect, createMemo, type JSX, Show } from 'solid-js';
import { emailDetailSearch } from '../email-route';
import { useEmailView } from '../email-view-context';
import { useEmailReaderPane } from '../reader-pane';
import type { EmailThreadTarget } from '../types';
import { useEmailDetailListNavigation } from '../use-email-detail-list-navigation';
import { EmailDetail } from '../views/email-detail';
import { MobileEmailDetail } from '../views/mobile/email-detail';

export function EmailDetailView(props: {
  thread: EmailThreadTarget;
  targetMessageId?: string;
  targetRequest?: string;
}) {
  const { closeThread, selectedThread } = useEmailView();
  const panel = useSplitPanelOrThrow();
  // In the reading pane the thread keeps its keys in the reader's scope, and
  // Escape hands the keyboard back to the list instead of closing it.
  const pane = useEmailReaderPane();
  const keyScope = pane?.hotkeyScope ?? panel.splitHotkeyScope;
  const notificationSource = useGlobalNotificationSource();
  const canAutofocus = useCanAutofocusSplitContent();
  const threadId = () => props.thread.id;
  const threadQuery = useThreadQuery(threadId, () => ({
    enabled: !!threadId(),
  }));
  // The route keys this view to one thread.
  const phaseAttributes = { 'email.thread_id': threadId() };
  usePending(
    'email.thread.identity',
    () => threadQuery.isResolvingIdentity,
    phaseAttributes
  );
  // The thread phase covers the lookup too, so the view's flow stays open
  // from the lookup's answer to the thread request it starts.
  usePending(
    'email.thread',
    () => threadQuery.isResolvingIdentity || threadQuery.isLoading,
    phaseAttributes
  );
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
  useSplitDisplayName(title);
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
  useBlockEntityCommands({
    id: props.thread.id,
    scopeId: keyScope,
    resolveEntity: commandEntity,
    onDeleted: closeThread,
    onEmailReminderSaved: async () => {
      await listNavigation.afterReminderSaved?.();
    },
    extraFavoriteHotkey: { hotkey: 's', hotkeyToken: TOKENS.email.star },
    extraMuteHotkey: { hotkey: 'shift+m', hotkeyToken: TOKENS.email.mute },
  });

  let container: HTMLDivElement | undefined;
  const focusContainer = () => container?.focus({ preventScroll: true });
  createSplitAutofocus({
    element: () => container ?? null,
    enabled: () => canAutofocus && panel.isPanelActive() && !isTouchDevice(),
  });
  createEffect(() => {
    if (!pane || pane.focusRequest() !== props.thread.id) return;
    pane.clearFocusRequest();
    focusContainer();
  });
  const listNavigation = useEmailDetailListNavigation(threadId);
  const hotkeyScope = () => keyScope;
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
        description: 'Reply all to message',
        keyDownHandler: handlers.activate,
        hotkeyToken: TOKENS.block.focus,
        hide: true,
      });
      registerScopeSignalHotkey(hotkeyScope, {
        hotkey: 'escape',
        description: 'Collapse message or back to list',
        // Escape unwinds thread state first (reply, expanded body, focused
        // message). Once nothing is left to unwind it goes back to the list
        // this thread was opened from.
        keyDownHandler: () => {
          if (handlers.cancel()) return true;
          (pane?.focusList ?? closeThread)();
          return true;
        },
        hotkeyToken: TOKENS.email.cancelReply,
        hide: true,
      });
    },
  };
  useListNavigationHotkeys({
    scopeId: keyScope,
    enabled: () =>
      panel.isPanelActive() && selectedThread()?.id === props.thread.id,
    navigation: listNavigation,
    arrowKeys: true,
  });
  const loadResult = {
    data: threadData,
    error: () =>
      threadQuery.isError ? toEntityLoadError(threadQuery.error) : undefined,
    isPending: () => threadQuery.isLoading,
  };

  const afterReminderSaved = async () => {
    await listNavigation.afterReminderSaved?.();
  };
  const threadFrame = (thread: () => JSX.Element) => (
    <div ref={container} class="relative min-h-0 min-w-0 flex-1" tabIndex={-1}>
      <EmailThreadLoadGate
        isLocalDraft={source.isLocalDraft()}
        result={loadResult}
        notificationSource={notificationSource}
        threadId={props.thread.id}
        onRetry={() => fireAndForget(threadQuery.refetch(), 'email-view')}
      >
        {thread()}
      </EmailThreadLoadGate>
    </div>
  );

  return (
    <SidePanel.Root floating defaultOpen={false}>
      <Show
        when={isTouchDevice()}
        fallback={
          <EmailDetail
            title={title()}
            threadId={threadId}
            source={source}
            host={host}
            listNavigation={listNavigation}
            inReadingPane={!!pane}
            hotkeyScope={keyScope}
            onClose={closeThread}
            onEmailReminderSaved={afterReminderSaved}
            frame={threadFrame}
          />
        }
      >
        <MobileEmailDetail
          title={title()}
          threadId={threadId}
          source={source}
          host={host}
          list={{
            onMarkedUnread: closeThread,
            onDeleted: closeThread,
            listNavigation,
            onEmailReminderSaved: afterReminderSaved,
          }}
          frame={threadFrame}
        />
      </Show>
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
