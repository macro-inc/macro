import { EmailRenderingProvider } from './context/email-rendering-context';
import { createEmailRenderingContext } from './rendering-adapter';
import { EmailSenderIcon } from './sender-icon-adapter';
import {
  EmailMessageView,
  type EmailMessageViewProps,
} from './views/email-message';

/** Production composition for rendering a single email on any surface. */
export function EmailMessage(props: EmailMessageViewProps) {
  const renderingContext = createEmailRenderingContext();
  return (
    <EmailRenderingProvider value={renderingContext}>
      <EmailMessageView
        renderAvatar={(message) => <EmailSenderIcon message={message} />}
        {...props}
      />
    </EmailRenderingProvider>
  );
}
