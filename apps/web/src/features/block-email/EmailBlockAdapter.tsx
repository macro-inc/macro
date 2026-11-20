import { useInlinePreviewLayout } from '@app/components/view-shell/use-inline-preview-layout';
import { isListViewID } from '@app/constants/list-views';
import type {
  EmailThreadHost,
  EmailThreadSource,
} from '@app/features/email-thread/context/email-thread-context';
import { URL_PARAMS } from '@app/features/email-thread/core/location';
import { emailDetailSearch } from '@app/features/email-view/email-route';
import { listNavigationSourceId } from '@app/features/soup/collection/list-navigation-source';
import { createSearchParams } from '@app/lib/split-router';
import { SplitLayoutContext } from '@components/app/split-layout/context';
import type { SplitId } from '@components/app/split-layout/layoutManager';
import {
  useCanAutofocusSplitContent,
  useSplitPanel,
} from '@components/app/split-layout/layoutUtils';
import { TOKENS } from '@core/hotkey/tokens';
import { registerScopeSignalHotkey } from '@core/hotkey/utils';
import { isNativeMobilePlatform } from '@core/mobile/isNativeMobilePlatform';
import { isTouchDevice } from '@core/mobile/isTouchDevice';
import { createMethodRegistration } from '@core/orchestrator';
import {
  blockElementSignal,
  blockHotkeyScopeSignal,
} from '@core/signal/blockElement';
import { blockHandleSignal } from '@core/signal/load';
import { useSearchParams } from '@solidjs/router';
import {
  type Accessor,
  createEffect,
  createSignal,
  on,
  onCleanup,
  Show,
  useContext,
} from 'solid-js';
import { useEmailListNavigation } from './use-email-list-navigation';
import { registerEmailHotkeys } from './util/emailHotkeys';
import { EmailThread } from './views/email-thread';
import { MobileEmailThread } from './views/mobile/email-thread';

/**
 * The email block's entry: it owns the thread's target, focus and keyboard,
 * then picks the desktop or the mobile view.
 */
export function EmailBlockAdapter(props: {
  title: string;
  threadId: Accessor<string>;
  source: EmailThreadSource;
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
  const splitManager = useContext(SplitLayoutContext)?.manager;
  const inlinePreviewLayout = useInlinePreviewLayout();
  const listNavigation = useEmailListNavigation(props.threadId);
  const canAutofocus = useCanAutofocusSplitContent();
  const blockElement = blockElementSignal.get;
  const hotkeyScope = blockHotkeyScopeSignal.get;
  const focusContainer = () => blockElement()?.focus({ preventScroll: true });
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
        description: 'Reply all to message',
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

  const mobileList = () => {
    const handle = split?.handle;
    if (!handle?.canGoBack() || inlinePreviewLayout()) return;

    // A direct URL open has no list source on its entry. Supplying an empty
    // fallback keeps it from inheriting the pane's identity.
    const originId = listNavigationSourceId({
      id: '' as SplitId,
      content: handle.content,
    });
    if (!originId) return;

    // Native Back closes the front pane. Mobile web Back uses pane history.
    const native = isNativeMobilePlatform();
    const behind = native ? splitManager?.splits().at(-2) : undefined;
    const previous = native ? behind?.content : handle.previousContent();
    if (previous?.type !== 'component' || !isListViewID(previous.id)) return;

    const backId = listNavigationSourceId({
      id: behind?.id ?? handle.id,
      content: () => previous,
    });
    if (backId === originId) {
      return { onDeleted: handle.goBack };
    }
  };

  return (
    <Show
      when={isTouchDevice()}
      fallback={
        <EmailThread
          title={props.title}
          threadId={props.threadId}
          source={props.source}
          host={host}
        />
      }
    >
      <MobileEmailThread
        title={props.title}
        threadId={props.threadId}
        source={props.source}
        host={host}
        list={mobileList()}
      />
    </Show>
  );
}
