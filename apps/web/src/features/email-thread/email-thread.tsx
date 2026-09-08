import { useGlobalNotificationSource } from '@components/app/GlobalAppState';
import { useEmail, useUserContext } from '@core/context/user';
import { isMobile } from '@core/mobile/isMobile';
import { isTouchDevice } from '@core/mobile/isTouchDevice';
import { useContacts } from '@core/user';
import { createEffectOnEntityTypeNotification } from '@notifications';
import { clearSavedDraftThreadCache } from '@queries/email/draft-cache';
import { useThreadQuery } from '@queries/email/thread';
import { createEffect, createMemo, onCleanup } from 'solid-js';
import { createEmailComposeHost } from '../email-compose/compose-host-adapter';
import { createEmailComposeServices } from '../email-compose/compose-service-adapter';
import { convertContactInfoToEmailRecipient } from '../email-compose/core/recipient-conversion';
import { createEmailAttachmentOpener } from '../email-message/attachment-action-adapter';
import type { EmailMessage } from '../email-message/core/email-message';
import { createEmailRenderingDependencies } from '../email-message/rendering-adapter';
import { EmailSenderIcon } from '../email-message/sender-icon-adapter';
import type { EmailThreadDependencies } from './context/email-thread-dependencies';
import { createEmailThreadSource } from './queries/thread-source';
import { createThreadActionAdapter } from './thread-action-adapter';
import {
  EmailThreadSurface,
  type EmailThreadSurfaceProps,
} from './views/email-thread-surface';

export type EmailThreadProps = Omit<
  EmailThreadSurfaceProps,
  'environment' | 'emailRendering'
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
  const compose = createEmailComposeServices();
  const dependencies: EmailThreadDependencies = {
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
  const environment = {
    copySubject: (subject: string) => {
      void navigator.clipboard
        .writeText(subject)
        .then(() => compose.notices.feedback.success('Subject copied'))
        .catch(() =>
          compose.notices.feedback.failure('Unable to copy subject')
        );
    },
    dependencies,
    compose,
    composeHost: createEmailComposeHost(),
    rendering: {
      openAttachment: createEmailAttachmentOpener(),
      renderAvatar: (message: EmailMessage) => (
        <EmailSenderIcon message={message} />
      ),
    },
  };
  const rendering = createEmailRenderingDependencies();
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
      environment={environment}
      emailRendering={rendering}
    />
  );
}
