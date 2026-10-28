import { emailPageInbox } from '../../core/email-demo-story';
import { WorkspaceDesktopDemo } from '../WorkspaceDesktopDemo';

export function EmailDesktopDemo() {
  return (
    <WorkspaceDesktopDemo
      heroFrame
      view="email"
      label="Try Macro Mail"
      initialData={{
        emails: emailPageInbox.map((email) => ({
          ...email,
          folder: 'inbox',
          body:
            email.body ??
            `Hi Jacob,\n\n${email.snippet}\n\nThanks,\n${email.sender}`,
          replies: [],
        })),
      }}
    />
  );
}
