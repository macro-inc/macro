import { useGlobalNotificationSource } from '@components/app/GlobalAppState';
import { useEmail, useUserContext } from '@core/context/user';
import { isMobile } from '@core/mobile/isMobile';
import { isTouchDevice } from '@core/mobile/isTouchDevice';
import { useContacts } from '@core/user';
import { createEffectOnEntityTypeNotification } from '@notifications';
import { clearSavedDraftThreadCache } from '@queries/email/draft-cache';
import { useThreadQuery } from '@queries/email/thread';
import { createEffect, createMemo, onCleanup } from 'solid-js';
import { createEmailComposeContext } from '../email-compose/compose-adapter';
import { createEmailComposeHost } from '../email-compose/compose-host-adapter';
import { convertContactInfoToEmailRecipient } from '../email-compose/core/recipient-conversion';
import { createEmailAttachmentOpener } from '../email-message/attachment-action-adapter';
import type { EmailMessage } from '../email-message/core/email-message';
import { createEmailRenderingContext } from '../email-message/rendering-adapter';
import { EmailSenderIcon } from '../email-message/sender-icon-adapter';
import type { EmailThreadContext } from './context/email-thread-context';
import { createEmailThreadSource } from './queries/thread-source';
import { createThreadActionAdapter } from './thread-action-adapter';
import {
  EmailThreadSurface,
  type EmailThreadSurfaceProps,
} from './views/email-thread-surface';

export type EmailThreadProps = Omit<
  EmailThreadSurfaceProps,
  'context' | 'emailRendering'
>;

/** App-facing composition. Import the surface or primitives for isolated tests. */
export function EmailThread(props: EmailThreadProps) {
  const query = useThreadQuery(props.threadId, () => ({
    enabled: !!props.threadId(),
  }));
  const source = createEmailThreadSource(props.threadId, query);
  const contacts = useContacts();
  const viewerEmail = useEmail();
  const user = useUserContext();
  const compose = createEmailComposeContext();
  const threadContext: EmailThreadContext = {
    source,
    viewerEmail,
    viewerLoading: user.isLoading,
    isMobile,
    isTouch: isTouchDevice,
    recipients: createMemo(() =>
      contacts().map((contact) => convertContactInfoToEmailRecipient(contact))
    ),
    createCommands: (snapshot) =>
      createThreadActionAdapter(props.threadId, snapshot),
  };
  const viewContext = {
    copySubject: (subject: string) => {
      void navigator.clipboard
        .writeText(subject)
        .then(() => compose.notices.feedback.success('Subject copied'))
        .catch(() =>
          compose.notices.feedback.failure('Unable to copy subject')
        );
    },
    thread: threadContext,
    compose,
    composeHost: createEmailComposeHost(),
    rendering: {
      openAttachment: createEmailAttachmentOpener(),
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
