import { openCalendarEventSplit } from '@app/features/calendar-view/open-calendar-event';
import { useCreateEmailEvent } from '@app/features/email-compose/email-event';
import type {
  EmailThreadHost,
  EmailThreadSource,
} from '@app/features/email-thread/context/email-thread-context';
import {
  selectThreadMessages,
  selectThreadParticipants,
} from '@app/features/email-thread/core/thread-messages';
import {
  EmailThread,
  type EmailThreadProps,
} from '@app/features/email-thread/email-thread';
import { taskSourceComposerContext } from '@app/features/task-composer/source-context';
import { SidePanel } from '@components/app/side-panel';
import { useSplitLayout } from '@components/app/split-layout/layout';
import { useEmail } from '@core/context/user';
import { fireAndForget } from '@core/util/fireAndForget';
import { buildMentionMarkdownString } from '@macro-inc/lexical-core';
import { useInboxEmail } from '@queries/email/inbox-email';
import { useEmailLinksQuery } from '@queries/email/link';
import { queryReadyGate } from '@queries/gate';
import type { Accessor, JSX } from 'solid-js';
import { QueuedSendStatus } from '../email-compose/queued-send-status';
import { EmailSidePanelSections } from './component/sidepanel/EmailSidePanelSections';

export type EmailThreadHostViewContext = {
  createTask: () => void;
  createEvent: () => boolean;
  canCreateEvent: () => boolean;
};

export type EmailThreadHostViewProps = {
  title: string;
  /** Host control after the subject's last word, in place of Copy subject. */
  titleTrailing?: JSX.Element;
  threadId: Accessor<string>;
  source: EmailThreadSource;
  threadTransport: EmailThreadProps['threadTransport'];
  host: EmailThreadHost;
  topBar?: (context: EmailThreadHostViewContext) => JSX.Element;
  /** Header actions the host adds through `SidePanel.HeaderActions`. */
  actions?: (context: EmailThreadHostViewContext) => JSX.Element;
  /** Host chrome that stays mounted for both drafts and message threads. */
  chrome?: (context: EmailThreadHostViewContext) => JSX.Element;
};

/** What the email block hands its desktop or mobile view. */
export type EmailBlockViewProps = Pick<
  EmailThreadHostViewProps,
  'title' | 'threadId' | 'source' | 'threadTransport' | 'host'
>;

/**
 * App-facing email thread body shared by block and in-view hosts.
 * Host-specific focus, keyboard, list navigation, and header composition
 * arrive explicitly: the body adds nothing to a host's header itself.
 */
export function EmailThreadHostView(props: EmailThreadHostViewProps) {
  const { popoverSplit } = useSplitLayout();
  const createTask = () =>
    popoverSplit({
      type: 'component',
      id: 'task-compose',
      params: {
        composerContext: taskSourceComposerContext({
          entity_type: 'THREAD',
          entity_id: props.threadId(),
        }),
        initialContent: buildMentionMarkdownString({
          type: 'document',
          documentId: props.threadId(),
          documentName: props.title,
          blockName: 'email',
        }),
      },
    });

  const emailEvent = useCreateEmailEvent();
  const emailLinks = useEmailLinksQuery();
  const viewerEmail = useInboxEmail(() => props.source.thread()?.link_id);
  const loginEmail = useEmail();
  // Until the inbox addresses load, the viewer's own alias would be invited.
  const canCreateEvent = () =>
    emailEvent.enabled() &&
    !!props.source.thread() &&
    queryReadyGate(emailLinks);
  const createEvent = () => {
    const thread = props.source.thread();
    if (!thread || !canCreateEvent()) return false;
    return emailEvent.open({
      subject: props.title,
      guests: selectThreadParticipants(thread, viewerEmail(), loginEmail()),
      text: selectThreadMessages(thread).filtered.at(-1)?.body_text ?? '',
    });
  };
  const context: EmailThreadHostViewContext = {
    createTask,
    createEvent,
    canCreateEvent,
  };
  const host: EmailThreadHost = {
    ...props.host,
    registerKeyboard: (handlers) =>
      props.host.registerKeyboard?.({
        ...handlers,
        createEvent,
        canCreateEvent,
      }),
  };

  return (
    <EmailThread
      title={props.title}
      titleTrailing={props.titleTrailing}
      threadId={props.threadId}
      source={props.source}
      threadTransport={props.threadTransport}
      host={host}
      openCalendar={(target) => {
        fireAndForget(openCalendarEventSplit(target), 'email-thread');
      }}
      header={props.topBar?.(context)}
      actions={props.actions?.(context)}
      frame={(content) => (
        <>
          {props.chrome?.(context)}
          <QueuedSendStatus threadId={props.threadId()} />
          <SidePanel.Layout floating defaultOpen={false} headerToggle={false}>
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
