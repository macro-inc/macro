import { message } from '../../email-message/tests/messages';
import { EmailInboxList } from '../../email-view/components/EmailInboxSelector';
import { FromInboxSelector } from '../components/from-inbox-selector';
import { fromInboxOptions } from '../core/email-sender';
import { createEmailFormState } from '../primitives/email-form-state';
import {
  fixtureInboxes,
  fixtureScope,
  setFixtureInboxes,
} from './sender-adapters';

export function SenderFixture() {
  const aliases = [
    { email_address: 'resident@example.com', displayName: 'Resident team' },
  ];
  setFixtureInboxes([
    { id: 'owned', email_address: 'base@example.com', sendAs: aliases },
    { id: 'delegated', email_address: 'manager@example.com', sendAs: aliases },
  ]);
  const parent = message('parent', {
    link_id: 'owned',
    to: [{ email: 'resident@example.com' }],
    from: { email: 'customer@example.com' },
  });
  const form = createEmailFormState(
    { viewerEmail: () => 'base@example.com', inboxes: fixtureInboxes },
    { type: 'replying_to', messageId: 'parent' },
    {
      getMessageById: () => parent,
      getDraftForMessageReply: () => undefined,
    }
  );
  return (
    <main class="min-h-screen bg-surface p-6 text-ink">
      <h1 class="mb-6 text-xl">Email aliases</h1>
      <div class="flex flex-wrap gap-8">
        <aside class="w-72 border-r border-edge-muted pr-4">
          <h2 class="mb-3">Email</h2>
          <EmailInboxList />
          <button
            onClick={() =>
              setFixtureInboxes([
                {
                  id: 'owned',
                  email_address: 'base@example.com',
                  sendAs: null,
                },
              ])
            }
          >
            Simulate unavailable aliases
          </button>
          <output data-testid="alias-filter">
            {JSON.stringify(fixtureScope)}
          </output>
        </aside>
        <section class="min-w-72 max-w-md">
          <h2 class="mb-3">Reply to customer@example.com</h2>
          <div class="flex items-center gap-3">
            <span>From</span>
            <FromInboxSelector
              links={fromInboxOptions(fixtureInboxes())}
              activeInboxId={form.selectedInboxId()}
              activeEmail={form.senderEmail()}
              onSelect={form.setSelectedInbox}
              pill
            />
          </div>
          <p class="mt-4">
            To:{' '}
            {form
              .recipients()
              .to.map((recipient) => recipient.data.email)
              .join(', ')}
          </p>
          <output data-testid="sender">
            {form.selectedInboxId()}:{form.senderEmail()}
          </output>
        </section>
      </div>
    </main>
  );
}
