import type {
  RecipientOption,
  ShareForm,
} from '@app/features/sharing/share-delivery/share-delivery';
import { ShareRecipientField } from '@core/component/ShareRecipientField';
import { createSignal } from 'solid-js';
import { reads } from './share-recipient-adapters';

/** The Share menu's real To field over an account with many channels and
 * contacts (`share-recipient-adapters.ts` sets their number from the URL). */
export function ShareRecipientsFixture() {
  const [recipients, setRecipients] = createSignal<RecipientOption[]>([]);
  const form: ShareForm<RecipientOption> = {
    recipients,
    setRecipients: (next) => setRecipients([...next]),
    group: () => undefined,
    setGroup: () => {},
    locked: () => false,
    level: () => undefined,
    setLevel: () => {},
    setText: () => {},
    setMentions: () => {},
    sendable: () => recipients().length > 0,
    notices: () => [],
    triedToSubmit: () => false,
    status: () => ({ t: 'editing' }),
    submit: async () => undefined,
  };
  return (
    <main class="p-6 max-w-xl bg-page text-ink min-h-screen">
      <ShareRecipientField form={form} />
      <pre data-testid="recipients">
        {JSON.stringify(recipients().map((item) => item.id))}
      </pre>
      <output data-testid="reads">{reads()}</output>
    </main>
  );
}
