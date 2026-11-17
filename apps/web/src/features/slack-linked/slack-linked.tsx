import { useNavigate } from '@app/lib/split-router';
import { externalChatRoute } from '@app/routes/routes';
import { useUserId } from '@core/context/user';
import { createOpenSections } from '../whatsapp-linked/primitives/open-sections';
import { SlackLinkedProvider } from './context/slack-linked-context';
import type { SlackHandoff } from './primitives/slack-page';
import { createSlackLinkedCapabilities } from './queries/production-capabilities';
import { SlackLinkedPage } from './slack-linked-page';

/** The Slack page wired to the app: shared queries and split navigation. */
export function SlackLinked(props: { handoff?: SlackHandoff }) {
  const navigate = useNavigate();
  const capabilities = createSlackLinkedCapabilities({
    openChat: (chatId) =>
      navigate({ route: externalChatRoute, params: { chatId } }),
    sections: createOpenSections(
      'macro:slack:conversation-sections:v1',
      useUserId()
    ),
  });
  return (
    <SlackLinkedProvider value={capabilities}>
      <SlackLinkedPage handoff={props.handoff} />
    </SlackLinkedProvider>
  );
}
