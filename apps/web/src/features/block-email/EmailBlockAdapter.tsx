import type {
  EmailThreadHost,
  EmailThreadSource,
} from '@app/features/email-thread/context/email-thread-context';
import { URL_PARAMS } from '@app/features/email-thread/core/location';
import {
  useCanAutofocusSplitContent,
  useSplitPanel,
} from '@components/app/split-layout/layoutUtils';
import { TOKENS } from '@core/hotkey/tokens';
import { registerScopeSignalHotkey } from '@core/hotkey/utils';
import { isTouchDevice } from '@core/mobile/isTouchDevice';
import { createMethodRegistration } from '@core/orchestrator';
import {
  blockElementSignal,
  blockHotkeyScopeSignal,
} from '@core/signal/blockElement';
import { blockHandleSignal } from '@core/signal/load';
import { useSearchParams } from '@solidjs/router';
import { type Accessor, createEffect, createSignal, onCleanup } from 'solid-js';
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
  const rawTarget = params[URL_PARAMS.messageId];
  const [targetMessageId, setTargetMessageId] = createSignal(
    Array.isArray(rawTarget) ? rawTarget[0] : rawTarget
  );
  const split = useSplitPanel();
  const listNavigation = useEmailListNavigation(props.threadId);
  const canAutofocus = useCanAutofocusSplitContent();
  const blockElement = blockElementSignal.get;
  const hotkeyScope = blockHotkeyScopeSignal.get;
  const focusContainer = () => blockElement()?.focus({ preventScroll: true });
  let targetTimer: ReturnType<typeof setTimeout> | undefined;
  createMethodRegistration(blockHandleSignal.get, {
    goToLocationFromParams: (params: Record<string, unknown>) => {
      const id = params[URL_PARAMS.messageId];
      if (typeof id !== 'string' || !id) return;
      clearTimeout(targetTimer);
      setTargetMessageId(undefined);
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
