import { EmailRenderingProvider } from './context/email-rendering-context';
import { createEmailRenderingDependencies } from './rendering-adapter';
import { EmailSenderIcon } from './sender-icon-adapter';
import {
  EmailMessageView,
  type EmailMessageViewProps,
} from './views/email-message';

/** Production composition for rendering a single email on any surface. */
export function EmailMessage(props: EmailMessageViewProps) {
  const dependencies = createEmailRenderingDependencies();
  return (
    <EmailRenderingProvider value={dependencies}>
      <EmailMessageView
        renderAvatar={(message) => <EmailSenderIcon message={message} />}
        {...props}
      />
    </EmailRenderingProvider>
  );
}
