import { AskMacroButton } from '@app/features/chat/ChatWithAgentButton';
import type { EmailThreadHost } from '@app/features/email-thread/context/email-thread-context';
import { useEmailThreadState } from '@app/features/email-thread/context/email-thread-state-context';
import { EmailThread } from '@app/features/email-thread/email-thread';
import { SidePanel } from '@components/app/side-panel';
import { useSplitLayout } from '@components/app/split-layout/layout';
import { buildMentionMarkdownString } from '@macro-inc/lexical-core';
import type { Accessor, JSX } from 'solid-js';
import { Show } from 'solid-js';
import { EmailTaskButton } from './component/EmailTaskButton';
import { ModalsProvider } from './component/ModalsProvider';
import { EmailSidePanelSections } from './component/sidepanel/EmailSidePanelSections';

export type EmailThreadHostViewContext = {
  createTask: () => void;
};

export type EmailThreadHostViewProps = {
  title: string;
  threadId: Accessor<string>;
  host: EmailThreadHost;
  topBar?: (context: EmailThreadHostViewContext) => JSX.Element;
  sidePanelHeaderToggle?: boolean;
  shareOpen?: boolean;
  onShareOpenChange?: (open: boolean) => void;
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
      host={props.host}
      header={props.topBar?.({ createTask })}
      actions={<ThreadActions title={props.title} onCreateTask={createTask} />}
      frame={(content) => (
        <ModalsProvider
          threadId={props.threadId()}
          subject={props.title}
          shareOpen={props.shareOpen}
          onShareOpenChange={props.onShareOpenChange}
        >
          <SidePanel.Layout
            defaultOpen={false}
            headerToggle={props.sidePanelHeaderToggle}
          >
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
