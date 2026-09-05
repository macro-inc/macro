import { EmailRenderingProvider } from './context/email-rendering-context';
import { createEmailRenderingDependencies } from './rendering-adapter';
import {
  EmailMessageView,
  type EmailMessageViewProps,
} from './views/email-message';

/** Production composition for rendering a single email on any surface. */
export function EmailMessage(props: EmailMessageViewProps) {
  const dependencies = createEmailRenderingDependencies();
  return (
    <EmailRenderingProvider value={dependencies}>
      <EmailMessageView {...props} />
    </EmailRenderingProvider>
  );
}
