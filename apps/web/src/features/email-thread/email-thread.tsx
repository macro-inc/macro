import { useGlobalNotificationSource } from '@components/app/GlobalAppState';
import { useUserContext } from '@core/context/user';
import { isTouchDevice } from '@core/mobile/isTouchDevice';
import { useContacts } from '@core/user';
import { fireAndForget } from '@core/util/fireAndForget';
import { createEffectOnEntityTypeNotification } from '@notifications';
import { InlineFetchedEntityTagsPill } from '@property/tags';
import { clearSavedDraftThreadCache } from '@queries/email/draft-cache';
import { useInboxEmail } from '@queries/email/inbox-email';
import type { ThreadQueryTransport } from '@queries/email/thread';
import {
  type Accessor,
  createEffect,
  createMemo,
  onCleanup,
  Suspense,
} from 'solid-js';
import { useCalendarPreferences } from '../calendar/utils/preferences';
import { createEmailComposeContext } from '../email-compose/compose-adapter';
import { createEmailComposeHost } from '../email-compose/compose-host-adapter';
import { convertContactInfoToEmailRecipient } from '../email-compose/core/recipient-conversion';
import {
  createEmailAttachmentOpener,
  downloadEmailAttachment,
} from '../email-message/attachment-action-adapter';
import type { CalendarInvitation } from '../email-message/core/calendar-invitation';
import type {
  EmailAttachment,
  EmailMessage,
} from '../email-message/core/email-message';
import { operationSettled } from '../email-message/core/message-operation';
import { EmailMessageOperation } from '../email-message/email-message-operation';
import { createEmailRenderingContext } from '../email-message/rendering-adapter';
import { EmailSenderIcon } from '../email-message/sender-icon-adapter';
import type { InvitationRenderOptions } from '../email-message/views/email-message';
import {
  type CalendarInvitationOpenTarget,
  EmailCalendarInvitation,
} from './calendar-invitation';
import type {
  EmailThreadContext,
  EmailThreadSource,
} from './context/email-thread-context';
import type { EmailThreadOrganizationStatus } from './context/email-thread-view-context';
import { EmailThreadOperations } from './email-thread-operations';
import { createOptimisticThreadSend } from './primitives/optimistic-send';
import { createThreadActionAdapter } from './thread-action-adapter';
import {
  EmailThreadSurface,
  type EmailThreadSurfaceProps,
} from './views/email-thread-surface';

export type EmailThreadProps = Omit<
  EmailThreadSurfaceProps,
  'context' | 'emailRendering'
> & {
  source: EmailThreadSource;
  threadTransport: Accessor<ThreadQueryTransport>;
  openCalendar?: (target: CalendarInvitationOpenTarget) => void;
};

/** App-facing composition. Import the surface or primitives for isolated tests. */
export function EmailThread(props: EmailThreadProps) {
  // The host's load gate already owns the live query. Reuse its source so
  // mounting the body does not start a second disk read/network request.
  const [calendarPreferences] = useCalendarPreferences();
  const contacts = useContacts();
  const user = useUserContext();
  const compose = createEmailComposeContext({
    threadTransport: props.threadTransport,
  });
  const source = createOptimisticThreadSend(props.source, compose);
  const viewerEmail = useInboxEmail(() => source.thread()?.link_id);
  const threadContext: EmailThreadContext = {
    source,
    viewerEmail,
    viewerLoading: user.isLoading,
    isTouch: isTouchDevice,
    recipients: createMemo(() =>
      contacts().map((contact) => convertContactInfoToEmailRecipient(contact))
    ),
    createCommands: (snapshot) =>
      createThreadActionAdapter(source.id, snapshot),
  };
  const viewContext = {
    copySubject: async (subject: string) => {
      try {
        await navigator.clipboard.writeText(subject);
        return true;
      } catch {
        compose.notices.feedback.failure('Unable to copy subject');
        return false;
      }
    },
    thread: threadContext,
    compose,
    composeHost: createEmailComposeHost(),
    rendering: {
      renderOrganizationStatus: (status: EmailThreadOrganizationStatus) => (
        <EmailThreadOperations
          threadId={source.id()}
          enabled={source.thread()?.access_level === 'owner'}
          announceRead={status.announceRead()}
        />
      ),
      renderOperation: (message: EmailMessage) =>
        message.operation && !operationSettled(message.operation) ? (
          <EmailMessageOperation message={message} />
        ) : undefined,
      renderTags: () => (
        <Suspense
          fallback={
            <span class="h-6 w-24 rounded-full bg-skeleton skeleton-shimmer" />
          }
        >
          <InlineFetchedEntityTagsPill
            entityId={props.threadId()}
            entityType="THREAD"
            class="bg-surface-2"
            showAddButton
          />
        </Suspense>
      ),
      renderInvitation: (
        message: EmailMessage,
        invitation: CalendarInvitation,
        options?: InvitationRenderOptions
      ) => (
        <EmailCalendarInvitation
          threadId={props.threadId()}
          messageId={message.db_id}
          invitation={invitation}
          hour12={calendarPreferences.timeFormat !== '24-hour'}
          openCalendar={props.openCalendar}
          onNavigate={options?.onNavigate}
          inCalendarFile={options?.inCalendarFile}
        />
      ),
      openAttachment: createEmailAttachmentOpener(),
      downloadAttachment: (attachment: EmailAttachment) => {
        fireAndForget(downloadEmailAttachment(attachment), 'email-attachment');
      },
      renderAvatar: (message: EmailMessage) => (
        <EmailSenderIcon message={message} />
      ),
    },
  };
  const rendering = createEmailRenderingContext();
  createEffectOnEntityTypeNotification(
    useGlobalNotificationSource(),
    'email',
    (notification) => {
      const meta = notification.notification_metadata;
      if (
        meta.tag === 'new_email' &&
        meta.content.threadId === source.thread()?.db_id
      )
        void source.refresh().catch(compose.notices.reportError);
    }
  );
  createEffect(() => {
    const id = props.threadId();
    onCleanup(() => clearSavedDraftThreadCache(id));
  });
  return (
    <EmailThreadSurface
      {...props}
      context={viewContext}
      emailRendering={rendering}
    />
  );
}
