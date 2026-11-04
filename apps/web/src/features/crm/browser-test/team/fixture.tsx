import '../../../../index.css';
import { isTouchDevice } from '@core/mobile/isTouchDevice';
import { storageServiceClient } from '@service-storage/client';
import { QueryClient, QueryClientProvider } from '@tanstack/solid-query';
import { Button } from '@ui';
import { createSignal, Show, Suspense } from 'solid-js';
import { render } from 'solid-js/web';
import { RecordVisibilityAction } from '../../components/record-visibility-action';
import { useCompanyQuery } from '../../queries/companies';
import {
  useContactQuery,
  useSetContactHiddenMutation,
} from '../../queries/contacts';
import { CompanyContactsSection } from '../../views/company-contacts-section';
import {
  companyReads,
  failNext,
  role,
  setFailNext,
  setRole,
  writes,
} from './preview-adapters';

const client = new QueryClient({
  defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
});
const deps = { client, storage: storageServiceClient };
document.documentElement.dataset.touchDevice = String(isTouchDevice());

function Team(props: { open(id: string): void }) {
  const company = useCompanyQuery(deps, () => 'company-1');
  return (
    <CompanyContactsSection
      company={company.company()}
      contacts={company.contacts()}
      onOpenContact={(contact) => props.open(contact.id)}
    />
  );
}

function Detail(props: { id: string }) {
  const contact = useContactQuery(deps, () => props.id);
  const mutation = useSetContactHiddenMutation(deps);
  const [error, setError] = createSignal('');
  return (
    <Show
      when={contact.isSuccess ? contact.data : undefined}
      fallback={<p>Contact unavailable</p>}
    >
      {(record) => (
        <div class="flex flex-col gap-4 p-4">
          <h2>{record().name}</h2>
          <RecordVisibilityAction
            recordId={record().id}
            name={record().name ?? 'Contact'}
            kind="contact"
            hidden={record().hidden}
            canManage={role() !== 'member'}
            pending={mutation.isPending}
            onChange={(hidden, onSuccess, onError) => {
              setError('');
              mutation.mutate(
                { contactId: record().id, hidden },
                {
                  onSuccess,
                  onError: () => {
                    onError();
                    setError('Could not update contact visibility');
                  },
                }
              );
            }}
          />
          <output aria-label="Contact identity">
            {record().id} / {record().companyId ?? 'unfiled'}
          </output>
          <Show when={error()}>
            <p role="alert">{error()}</p>
          </Show>
        </div>
      )}
    </Show>
  );
}
function Fixture() {
  const [contactId, setContactId] = createSignal<string>();
  const [keepTeam, setKeepTeam] = createSignal(false);
  return (
    <QueryClientProvider client={client}>
      <main class="flex h-dvh flex-col bg-panel text-ink">
        <h1 class="p-4 text-xl font-semibold">Example company</h1>
        <nav class="flex flex-wrap gap-2 p-4" aria-label="Fixture navigation">
          <Button onClick={() => setContactId(undefined)}>Company Team</Button>
          <Button onClick={() => setContactId('visible-contact')}>
            Open contact directly
          </Button>
          <Button onClick={() => setContactId('removed-contact')}>
            Open removed directly
          </Button>
          <Button onClick={() => setContactId('unfiled-contact')}>
            Open unfiled directly
          </Button>
          <Button onClick={() => setKeepTeam((value) => !value)}>
            Keep Team mounted
          </Button>
          <Button onClick={() => setFailNext(true)} disabled={failNext()}>
            Fail next write
          </Button>
          <Button
            onClick={() => setRole(role() === 'member' ? 'admin' : 'member')}
          >
            Toggle member role
          </Button>
        </nav>
        <Suspense fallback={<p>Loading</p>}>
          <Show when={contactId()} keyed>
            {(id) => <Detail id={id} />}
          </Show>
          <Show when={!contactId() || keepTeam()}>
            <Team open={setContactId} />
          </Show>
        </Suspense>
        <output aria-label="Company reads">{companyReads()}</output>
        <output aria-label="Successful writes">{writes()}</output>
      </main>
    </QueryClientProvider>
  );
}
render(Fixture, document.getElementById('root')!);
