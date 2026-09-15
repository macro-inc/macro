import { AskMacroButton } from '@app/features/chat/ChatWithAgentButton';
import { useEmailThreadState } from '@app/features/email-thread/context/email-thread-state-context';
import { URL_PARAMS } from '@app/features/email-thread/core/location';
import { EmailThread } from '@app/features/email-thread/email-thread';
import { SidePanel } from '@components/app/side-panel';
import { useSplitLayout } from '@components/app/split-layout/layout';
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
import { buildMentionMarkdownString } from '@macro-inc/lexical-core';
import { useSearchParams } from '@solidjs/router';
import {
  type Accessor,
  createEffect,
  createSignal,
  onCleanup,
  Show,
} from 'solid-js';
import { EmailTaskButton } from './component/EmailTaskButton';
import { ModalsProvider } from './component/ModalsProvider';
import { EmailSidePanelSections } from './component/sidepanel/EmailSidePanelSections';
import { TopBar } from './component/TopBar';
import { useEmailListNavigation } from './use-email-list-navigation';
import { registerEmailHotkeys } from './util/emailHotkeys';

export function EmailBlockAdapter(props: {
  title: string;
  threadId: Accessor<string>;
}) {
  const [params] = useSearchParams();
  const rawTarget = params[URL_PARAMS.messageId];
  const [targetMessageId, setTargetMessageId] = createSignal(
    Array.isArray(rawTarget) ? rawTarget[0] : rawTarget
  );
  const split = useSplitPanel();
  const listNavigation = useEmailListNavigation(props.threadId);
  const canAutofocus = useCanAutofocusSplitContent();
  const { popoverSplit } = useSplitLayout();
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
  const createTask = () =>
    popoverSplit({
      type: 'component',
      id: 'task-compose',
      params: {
        initialTitle:
          props.title.length > 70
            ? `${props.title.slice(0, 70)}...`
            : props.title,
        initialContent: buildMentionMarkdownString({
          type: 'document',
          documentId: props.threadId(),
          documentName: props.title,
          blockName: 'email',
        }),
      },
    });
  return (
    <EmailThread
      title={props.title}
      threadId={props.threadId}
      host={{
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
      }}
      header={
        <TopBar
          id={props.threadId()}
          title={props.title}
          onCreateTask={createTask}
        />
      }
      actions={<ThreadActions title={props.title} onCreateTask={createTask} />}
      frame={(content) => (
        <ModalsProvider subject={props.title}>
          <SidePanel.Layout>
            {content()}
            <EmailSidePanelSections
              threadId={props.threadId()}
              title={props.title}
            />
          </SidePanel.Layout>
        </ModalsProvider>
      )}
    />
  );
}

function ThreadActions(props: { title: string; onCreateTask: () => void }) {
  const context = useEmailThreadState();
  return (
    <SidePanel.Section
      id="email-ai-actions"
      title="Actions"
      defaultOpen
      order={0}
    >
      <div class="m-px flex items-center justify-start gap-2">
        <Show when={context.thread()?.db_id}>
          {(id) => (
            <AskMacroButton
              entity={{ type: 'email', id: id(), name: props.title }}
            />
          )}
        </Show>
        <Show when={context.thread()?.db_id}>
          <EmailTaskButton onClick={props.onCreateTask} />
        </Show>
      </div>
    </SidePanel.Section>
  );
}
