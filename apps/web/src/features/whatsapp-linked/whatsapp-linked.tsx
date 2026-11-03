import { useNavigate } from '@app/lib/split-router';
import { externalChatRoute } from '@app/routes/routes';
import { useUserId } from '@core/context/user';
import { WhatsAppLinkedProvider } from './context/whatsapp-linked-context';
import { createOpenSections } from './primitives/open-sections';
import { createWhatsAppLinkedCapabilities } from './queries/production-capabilities';
import { WhatsAppPage } from './views/whatsapp-page';

/** The WhatsApp page wired to the app: shared queries and split navigation. */
export function WhatsAppLinked(props: { resumePairingId?: string }) {
  const navigate = useNavigate();
  const capabilities = createWhatsAppLinkedCapabilities({
    openChat: (chatId) =>
      navigate({ route: externalChatRoute, params: { chatId } }),
    sections: createOpenSections(
      'macro:whatsapp:chat-sections:v2',
      useUserId()
    ),
  });
  return (
    <WhatsAppLinkedProvider value={capabilities}>
      <WhatsAppPage resumePairingId={props.resumePairingId} />
    </WhatsAppLinkedProvider>
  );
}
