import { defaultEditorInitialValues } from '@app/features/calendar/components/composer/event-form-model';
import { useCalendarUiFlag } from '@app/features/calendar/hooks/use-calendar-ui-flag';
import { useOpenEventComposer } from '@app/features/calendar-view/components/use-open-event-composer';
import { openCalendarEventSplit } from '@app/features/calendar-view/open-calendar-event';
import { AskMacroButton } from '@app/features/chat/ChatWithAgentButton';
import { isPlaceholderSubject } from '@app/features/email-compose/core/subject-text';
import type {
  EmailThreadHost,
  EmailThreadSource,
} from '@app/features/email-thread/context/email-thread-context';
import { useEmailThreadState } from '@app/features/email-thread/context/email-thread-state-context';
import { selectThreadParticipants } from '@app/features/email-thread/core/thread-messages';
import {
  EmailThread,
  type EmailThreadProps,
} from '@app/features/email-thread/email-thread';
import { taskSourceComposerContext } from '@app/features/task-composer/source-context';
import { useUniversalInputEnabled } from '@app/features/universal-input/use-universal-input';
import { HeaderActionGroup } from '@components/app/HeaderActionGroup';
import { SidePanel } from '@components/app/side-panel';
import { useSplitLayout } from '@components/app/split-layout/layout';
import { useEmail } from '@core/context/user';
import { isTouchDevice } from '@core/mobile/isTouchDevice';
import { fireAndForget } from '@core/util/fireAndForget';
import { buildMentionMarkdownString } from '@macro-inc/lexical-core';
import { useInboxEmail } from '@queries/email/inbox-email';
import { useEmailLinksQuery } from '@queries/email/link';
import { queryReadyGate } from '@queries/gate';
import type { Accessor, JSX } from 'solid-js';
import { Show } from 'solid-js';
import { QueuedSendStatus } from '../email-compose/queued-send-status';
import { EmailTaskButton } from './component/EmailTaskButton';
import { EmailSidePanelSections } from './component/sidepanel/EmailSidePanelSections';
import { suggestThreadEvent } from './thread-event-suggestions';

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

  const calendarEnabled = useCalendarUiFlag();
  const extractionEnabled = useUniversalInputEnabled();
  const openEventComposer = useOpenEventComposer();
  const emailLinks = useEmailLinksQuery();
  const viewerEmail = useInboxEmail(() => props.source.thread()?.link_id);
  const loginEmail = useEmail();
  // Until the inbox addresses load, the viewer's own alias would be invited.
  const canCreateEvent = () =>
    calendarEnabled() && !!props.source.thread() && queryReadyGate(emailLinks);
  const createEvent = () => {
    const thread = props.source.thread();
    if (!thread || !canCreateEvent()) return false;
    const title = isPlaceholderSubject(props.title) ? '' : props.title;
    openEventComposer({
      suggestedValues: extractionEnabled()
        ? suggestThreadEvent(thread, title)
        : undefined,
      initialValues: {
        // The composer settles the Macro call default once its flag loads.
        ...defaultEditorInitialValues(new Date(), true),
        title,
        guests: selectThreadParticipants(
          thread,
          viewerEmail(),
          loginEmail()
        ).join(', '),
      },
    });
    return true;
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
      actions={<ThreadActions title={props.title} onCreateTask={createTask} />}
      frame={(content) => (
        <>
          {props.chrome?.(context)}
          <QueuedSendStatus threadId={props.threadId()} />
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

function ThreadActions(props: { title: string; onCreateTask: () => void }) {
  const context = useEmailThreadState();
  return (
    <SidePanel.HeaderActions>
      <HeaderActionGroup label="Actions" size="md">
        <Show when={context.thread()?.db_id}>
          {(id) => (
            <AskMacroButton
              grouped
              size={isTouchDevice() ? undefined : 'icon-md'}
              entity={{ type: 'email', id: id(), name: props.title }}
            />
          )}
        </Show>
        <Show when={context.thread()?.db_id}>
          <EmailTaskButton
            grouped
            size={isTouchDevice() ? undefined : 'icon-md'}
            onClick={props.onCreateTask}
          />
        </Show>
      </HeaderActionGroup>
    </SidePanel.HeaderActions>
  );
}
