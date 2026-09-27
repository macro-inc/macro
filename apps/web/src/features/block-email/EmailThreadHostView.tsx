import type {
  EmailThreadHost,
  EmailThreadSource,
} from '@app/features/email-thread/context/email-thread-context';
import {
  EmailThread,
  type EmailThreadProps,
} from '@app/features/email-thread/email-thread';
import { SidePanel } from '@components/app/side-panel';
import { useSplitLayout } from '@components/app/split-layout/layout';
import { buildMentionMarkdownString } from '@macro-inc/lexical-core';
import type { Accessor, JSX } from 'solid-js';
import { EmailSidePanelSections } from './component/sidepanel/EmailSidePanelSections';

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
      source={props.source}
      threadTransport={props.threadTransport}
      host={props.host}
      header={props.topBar?.({ createTask })}
      frame={(content) => (
        <>
          {props.chrome?.({ createTask })}
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
        </>
      )}
    />
  );
}
