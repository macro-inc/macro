import { openCalendarEventSplit } from '@app/features/calendar-view/open-calendar-event';
import { AskMacroButton } from '@app/features/chat/ChatWithAgentButton';
import type {
  EmailThreadHost,
  EmailThreadSource,
} from '@app/features/email-thread/context/email-thread-context';
import { useEmailThreadState } from '@app/features/email-thread/context/email-thread-state-context';
import {
  EmailThread,
  type EmailThreadProps,
} from '@app/features/email-thread/email-thread';
import { SidePanel } from '@components/app/side-panel';
import { useSplitLayout } from '@components/app/split-layout/layout';
import { useSplitPanel } from '@components/app/split-layout/layoutUtils';
import { isTouchDevice } from '@core/mobile/isTouchDevice';
import { buildMentionMarkdownString } from '@macro-inc/lexical-core';
import { ButtonGroup } from '@ui';
import type { Accessor, JSX } from 'solid-js';
import { mergeProps, Show } from 'solid-js';
import { EmailTaskButton } from './component/EmailTaskButton';
import { EmailThreadControls } from './component/EmailThreadControls';
import { EmailSidePanelSections } from './component/sidepanel/EmailSidePanelSections';
import {
  type EmailThreadToolsOptions,
  useEmailThreadTools,
} from './component/useEmailThreadTools';

export type EmailThreadHostViewContext = {
  createTask: () => void;
};

export type EmailThreadHostViewProps = {
  title: string;
  threadId: Accessor<string>;
  source: EmailThreadSource;
  threadTransport: EmailThreadProps['threadTransport'];
  host: EmailThreadHost;
  topBar?: (context: EmailThreadHostViewContext) => JSX.Element;
  /** Host chrome that stays mounted for both drafts and message threads. */
  chrome?: (context: EmailThreadHostViewContext) => JSX.Element;
  sidePanelHeaderToggle?: boolean;
};

/**
 * App-facing email thread body shared by block and in-view hosts.
 * Host-specific focus, keyboard, list navigation, and top-bar composition
 * arrive explicitly.
 */
export function EmailThreadHostView(props: EmailThreadHostViewProps) {
  const { popoverSplit } = useSplitLayout();
  const createTask = () =>
    popoverSplit({
      type: 'component',
      id: 'task-compose',
      params: {
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
      source={props.source}
      threadTransport={props.threadTransport}
      host={props.host}
      openCalendar={(target) => {
        void openCalendarEventSplit(target);
      }}
      header={props.topBar?.({ createTask })}
      actions={
        <ThreadActions
          id={props.threadId()}
          title={props.title}
          onCreateTask={createTask}
          listNavigation={props.host.listNavigation}
          onMarkedUnread={props.host.returnToList}
          onDeleted={props.host.returnToList}
        />
      }
      frame={(content) => (
        <>
          {props.chrome?.({ createTask })}
          <SidePanel.Layout
            floating
            defaultOpen={false}
            headerToggle={props.sidePanelHeaderToggle}
          >
            {content()}
            <EmailSidePanelSections
              threadId={props.threadId()}
              title={props.title}
            />
          </SidePanel.Layout>
        </>
      )}
    />
  );
}

function ThreadActions(props: EmailThreadToolsOptions) {
  const context = useEmailThreadState();
  const panel = useSplitPanel();
  const { controls, shareTool } = useEmailThreadTools(
    mergeProps(props, {
      hotkeyScope: panel?.splitHotkeyScope,
      textOnlyActions: !isTouchDevice(),
    })
  );
  const contextualActions = (textOnly = false) => (
    <>
      <Show when={context.thread()?.db_id}>
        {(id) => (
          <AskMacroButton
            label="Ask AI"
            textOnly={textOnly}
            entity={{ type: 'email', id: id(), name: props.title }}
          />
        )}
      </Show>
      <Show when={!!context.thread()?.db_id && props.onCreateTask}>
        {(createTask) => (
          <>
            <Show when={textOnly}>
              <span aria-hidden="true" class="h-4 w-px bg-ink/10" />
            </Show>
            <EmailTaskButton onClick={createTask()} textOnly={textOnly} />
          </>
        )}
      </Show>
    </>
  );
  return (
    <Show
      when={!isTouchDevice()}
      fallback={
        <SidePanel.HeaderActions>
          <div class="flex shrink-0 items-center gap-1">
            {contextualActions()}
          </div>
        </SidePanel.HeaderActions>
      }
    >
      <SidePanel.HeaderActions>
        <div
          role="group"
          aria-label="Email actions"
          class="flex shrink-0 items-center gap-0.5"
        >
          {contextualActions(true)}
          <Show when={shareTool.condition?.()}>
            <Show when={context.thread()?.db_id}>
              <span aria-hidden="true" class="h-4 w-px bg-ink/10" />
            </Show>
            {shareTool.buttonComponent?.()}
          </Show>
        </div>
      </SidePanel.HeaderActions>
      <Show when={controls.isOwnThread}>
        <ButtonGroup
          variant="outline"
          size="icon-sm"
          class="bg-surface-2 [&_[data-button]]:h-5.5 [&_[data-button]]:py-0"
          aria-label="Email status"
        >
          <EmailThreadControls {...controls} />
        </ButtonGroup>
      </Show>
    </Show>
  );
}
