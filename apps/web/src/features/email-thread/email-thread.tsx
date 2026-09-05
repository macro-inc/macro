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
import { createEmailRenderingDependencies } from '../email-message/rendering-adapter';
import type { EmailThreadDependencies } from './context/email-thread-dependencies';
import { createThreadSnapshot } from './primitives/thread-snapshot';
import { createEmailThreadSource } from './queries/thread-source';
import { createThreadActionAdapter } from './thread-action-adapter';
import {
  EmailThreadSurface,
  type EmailThreadSurfaceProps,
} from './views/email-thread-surface';

export type EmailThreadProps = Omit<
  EmailThreadSurfaceProps,
  'dependencies' | 'environment' | 'emailRendering'
>;

/** App-facing composition. Import the surface or primitives for isolated tests. */
export function EmailThread(props: EmailThreadProps) {
  const query = useThreadQuery(props.threadId, () => ({
    enabled: !!props.threadId(),
  }));
  const source = createEmailThreadSource(props.threadId, query);
  const snapshot = createThreadSnapshot(source);
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
    commands: createThreadActionAdapter(props.threadId, snapshot),
  };
  const environment = {
    copySubject: (subject: string) => {
      void navigator.clipboard
        .writeText(subject)
        .then(() => compose.feedback.success('Subject copied'))
        .catch(() => compose.feedback.failure('Unable to copy subject'));
    },
    dependencies,
    compose,
    composeHost: createEmailComposeHost(),
    rendering: { openAttachment: createEmailAttachmentOpener() },
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
        source.refresh();
    }
  );
  createEffect(() => {
    const id = props.threadId();
    onCleanup(() => clearSavedDraftThreadCache(id));
  });
  return (
    <EmailThreadSurface
      {...props}
      dependencies={dependencies}
      environment={environment}
      emailRendering={rendering}
    />
  );
}
