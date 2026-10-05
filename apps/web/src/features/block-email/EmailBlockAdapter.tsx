import type {
  EmailThreadHost,
  EmailThreadSource,
} from '@app/features/email-thread/context/email-thread-context';
import { URL_PARAMS } from '@app/features/email-thread/core/location';
import { emailDetailSearch } from '@app/features/email-view/email-route';
import {
  makeFavoriteAction,
  makeMuteAction,
} from '@app/features/next-soup/actions';
import { trashEmails } from '@app/features/next-soup/utils';
import { createSearchParams } from '@app/lib/split-router';
import { useGlobalNotificationSource } from '@components/app/GlobalAppState';
import {
  useCanAutofocusSplitContent,
  useSplitPanel,
} from '@components/app/split-layout/layoutUtils';
import { toast } from '@core/component/Toast/Toast';
import { TOKENS } from '@core/hotkey/tokens';
import { registerScopeSignalHotkey } from '@core/hotkey/utils';
import { isTouchDevice } from '@core/mobile/isTouchDevice';
import { createMethodRegistration } from '@core/orchestrator';
import {
  blockElementSignal,
  blockHotkeyScopeSignal,
} from '@core/signal/blockElement';
import { blockHandleSignal } from '@core/signal/load';
import { buildEntityData } from '@entity';
import ArrowCounterClockwise from '@phosphor-icons/core/regular/arrow-counter-clockwise.svg?component-solid';
import { useSearchParams } from '@solidjs/router';
import {
  type Accessor,
  createEffect,
  createMemo,
  createSignal,
  on,
  onCleanup,
} from 'solid-js';
import { TopBar } from './component/TopBar';
import {
  EmailThreadHostView,
  type EmailThreadHostViewProps,
} from './EmailThreadHostView';
import { useEmailListNavigation } from './use-email-list-navigation';
import { registerEmailHotkeys } from './util/emailHotkeys';

export function EmailBlockAdapter(props: {
  title: string;
  threadId: Accessor<string>;
  source: EmailThreadSource;
  threadTransport: EmailThreadHostViewProps['threadTransport'];
}) {
  const [params] = useSearchParams();
  const [routeSearch] = createSearchParams(emailDetailSearch);
  const rawTarget = params[URL_PARAMS.messageId];
  const [targetMessageId, setTargetMessageId] = createSignal(
    routeSearch.messageId ||
      (Array.isArray(rawTarget) ? rawTarget[0] : rawTarget)
  );
  let routeOwnsTarget = Boolean(routeSearch.messageId);
  const [targetRequest, setTargetRequest] = createSignal<string | undefined>(
    routeOwnsTarget ? routeSearch.seek : undefined
  );
  const split = useSplitPanel();
  const listNavigation = useEmailListNavigation(props.threadId);
  const canAutofocus = useCanAutofocusSplitContent();
  const blockElement = blockElementSignal.get;
  const hotkeyScope = blockHotkeyScopeSignal.get;
  const focusContainer = () => blockElement()?.focus({ preventScroll: true });

  // Entity actions for Superhuman-style shortcuts
  const notificationSource = useGlobalNotificationSource();
  const favoriteAction = makeFavoriteAction();
  const muteAction = makeMuteAction({
    notificationSource: () => notificationSource,
  });

  const emailEntity = createMemo(() => {
    const thread = props.source.thread();
    return buildEntityData({
      id: props.threadId(),
      name: props.title,
      blockName: 'email',
      projectId: thread?.project_id ?? undefined,
      isRead: thread?.is_read,
      done: thread ? !thread.inbox_visible : undefined,
    });
  });

  const toggleStar = () => {
    const entity = emailEntity();
    if (!entity || !favoriteAction.canExecute(entity)) return false;
    void favoriteAction.execute([entity]);
    return true;
  };

  const isStarred = () => {
    const entity = emailEntity();
    return entity ? favoriteAction.isFavorited(entity) : false;
  };

  const trashThread = () => {
    const thread = props.source.thread();
    if (!thread?.db_id) return false;

    const handle = trashEmails([{ id: thread.db_id, linkId: thread.link_id }]);
    const toastId = toast.success('Moved to Trash', {
      actions: [
        {
          label: 'Undo',
          icon: ArrowCounterClockwise,
          onClick: () => {
            if (toastId != null) toast.dismiss(toastId);
            handle.undo().then(
              () => toast.success('Restored from Trash'),
              () => toast.failure('Failed to restore from Trash')
            );
          },
        },
      ],
      duration: 10_000,
    });
    handle.done.catch(() => {
      toast.failure('Failed to move to Trash');
    });
    return true;
  };

  const toggleMute = () => {
    const entity = emailEntity();
    if (!entity || !muteAction.canExecute(entity)) return false;
    void muteAction.execute([entity]);
    return true;
  };

  const isMuted = () => {
    const entity = emailEntity();
    return entity ? muteAction.isMuted(entity) : false;
  };
  let targetTimer: ReturnType<typeof setTimeout> | undefined;
  createEffect(
    on(
      () => [routeSearch.messageId, routeSearch.seek],
      () => {
        if (!routeSearch.messageId) {
          if (routeOwnsTarget) {
            routeOwnsTarget = false;
            setTargetMessageId(undefined);
            setTargetRequest(undefined);
          }
          return;
        }
        clearTimeout(targetTimer);
        routeOwnsTarget = true;
        setTargetMessageId(routeSearch.messageId);
        setTargetRequest(routeSearch.seek);
      },
      { defer: true }
    )
  );
  createMethodRegistration(blockHandleSignal.get, {
    goToLocationFromParams: (params: Record<string, unknown>) => {
      const id = params[URL_PARAMS.messageId];
      if (typeof id !== 'string' || !id) return;
      clearTimeout(targetTimer);
      routeOwnsTarget = false;
      setTargetMessageId(undefined);
      setTargetRequest(undefined);
      targetTimer = setTimeout(() => setTargetMessageId(id), 0);
    },
  });
  onCleanup(() => clearTimeout(targetTimer));
  let focused = false;
  createEffect(() => {
    if (focused || !canAutofocus || isTouchDevice() || !blockElement()) return;
    focusContainer();
    focused = true;
  });
  const host: EmailThreadHost = {
    listNavigation,
    targetMessageId,
    targetRequest,
    focusContainer,
    isActive: () => split?.isPanelActive() !== false,
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
    entityActions: {
      toggleStar,
      isStarred,
      trash: trashThread,
      toggleMute,
      isMuted,
    },
  };

  return (
    <EmailThreadHostView
      title={props.title}
      threadId={props.threadId}
      source={props.source}
      threadTransport={props.threadTransport}
      host={host}
      topBar={({ createTask }) => (
        <TopBar
          id={props.threadId()}
          title={props.title}
          onCreateTask={createTask}
        />
      )}
    />
  );
}
