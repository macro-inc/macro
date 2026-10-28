import { fireAndForget } from '@core/util/fireAndForget';
import { ThrownResultError } from '@core/util/result';
import EnvelopeIcon from '@icon/system/regular/envelope.svg';
import XIcon from '@icon/system/regular/x.svg';
import { Button, Dialog, EntityComposer, Panel } from '@ui';
import { createMemo, createSignal, Show } from 'solid-js';
import {
  type CompanyOption,
  CompanySelect,
} from '../components/company-select';
import {
  useCreateContactMutation,
  useQuickAccessCrmCompaniesQuery,
} from './use-crm';

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function contactCreationError(cause: unknown): string {
  if (cause instanceof ThrownResultError) {
    if (cause.errors.some((e) => e.code === 'CONFLICT')) {
      return 'A contact with this email already exists.';
    }
    if (cause.errors.some((e) => e.code === 'FORBIDDEN')) {
      return "CRM isn't enabled for your team.";
    }
  }
  return 'Failed to create contact. Try again.';
}

/** Explicitly select any company, including one without a domain. */
function ContactCompanySelect(props: {
  mount: HTMLElement | undefined;
  disabled: boolean;
  value: CompanyOption | undefined;
  onChange: (company: CompanyOption) => void;
}) {
  const suggestions = useQuickAccessCrmCompaniesQuery();
  const options = createMemo(() =>
    suggestions.companies().map((company) => ({
      id: company.id,
      name: company.name,
      domain: company.domains[0]?.domain,
    }))
  );
  return (
    <CompanySelect
      id="new-contact-company"
      companies={options()}
      value={props.value}
      onChange={props.onChange}
      loading={suggestions.query.isLoading}
      disabled={props.disabled}
      mount={props.mount}
    />
  );
}

export function CreateContactModal(props: {
  /** Opens the dialog; without a company, the dialog asks for one. */
  target?: { company?: { companyId: string } };
  onClose(): void;
  onCreated(id: string): void;
}) {
  const createContactMutation = useCreateContactMutation();
  const [name, setName] = createSignal('');
  const [email, setEmail] = createSignal('');
  const [pickedCompany, setPickedCompany] = createSignal<CompanyOption>();
  // The panel clips overflow, so the company menu mounts on the dialog itself.
  const [dialog, setDialog] = createSignal<HTMLElement>();
  const [error, setError] = createSignal<string>();
  const company = () => {
    const picked = pickedCompany();
    return props.target?.company ?? (picked && { companyId: picked.id });
  };
  const contactName = createMemo(() => name().trim());
  const contactEmail = createMemo(() => email().trim().toLowerCase());
  const canSubmit = createMemo(
    () =>
      contactName().length > 0 &&
      contactEmail().length > 0 &&
      company() !== undefined &&
      !createContactMutation.isPending
  );

  function reset() {
    setName('');
    setEmail('');
    setPickedCompany(undefined);
    setError(undefined);
  }

  function resetAndClose() {
    reset();
    props.onClose();
  }

  function close() {
    if (createContactMutation.isPending) return;
    resetAndClose();
  }

  async function submit() {
    if (createContactMutation.isPending) return;
    const target = company();
    if (!target) {
      setError('Choose a company');
      return;
    }
    if (!contactName()) {
      setError('Enter a name');
      return;
    }
    if (!EMAIL_PATTERN.test(contactEmail())) {
      setError('Enter a valid email address');
      return;
    }

    setError(undefined);
    try {
      const { id } = await createContactMutation.mutateAsync({
        companyId: target.companyId,
        name: contactName(),
        email: contactEmail(),
      });
      resetAndClose();
      props.onCreated(id);
    } catch (cause) {
      console.error('Failed to create contact', cause);
      setError(contactCreationError(cause));
    }
  }

  return (
    <Dialog
      open={props.target !== undefined}
      onOpenChange={(open) => !open && close()}
      contentRef={(element) => setDialog(element)}
    >
      <Panel hideBorder class="bg-transparent rounded-[inherit] *:max-h-[75vh]">
        <Panel.Body>
          <form
            class="h-full min-h-0"
            aria-label="New contact"
            onSubmit={(event) => {
              event.preventDefault();
              fireAndForget(submit(), 'crm');
            }}
            onKeyDown={(event) => {
              if (
                event.key === 'Enter' &&
                (event.metaKey || event.ctrlKey) &&
                !event.isComposing
              ) {
                event.preventDefault();
                event.stopPropagation();
                fireAndForget(submit(), 'crm');
              }
            }}
          >
            <EntityComposer.Root>
              <EntityComposer.Header>
                <Dialog.Title class="sr-only">New contact</Dialog.Title>
                <EntityComposer.Title class="mb-0 min-w-0 flex-1 self-center">
                  <input
                    autofocus
                    aria-label="Contact name"
                    placeholder="Contact name"
                    autocomplete="off"
                    data-1p-ignore
                    aria-invalid={error() === 'Enter a name'}
                    class="ph-no-capture w-full min-w-0 text-xl/7 font-medium outline-none bg-transparent placeholder:text-ink-placeholder"
                    value={name()}
                    disabled={createContactMutation.isPending}
                    onInput={(event) => {
                      setName(event.currentTarget.value);
                      setError(undefined);
                    }}
                  />
                </EntityComposer.Title>
                <Button
                  tabIndex={-1}
                  aria-label="Close"
                  tooltip="Close"
                  size="icon-composer"
                  disabled={createContactMutation.isPending}
                  onClick={close}
                >
                  <XIcon />
                </Button>
              </EntityComposer.Header>
              <EntityComposer.Main class="gap-4">
                <label class="flex min-w-0 items-center gap-2 px-2 text-sm">
                  <EnvelopeIcon
                    aria-hidden="true"
                    class="size-4 shrink-0 text-ink-muted"
                  />
                  <span class="flex min-w-0 items-center">
                    <input
                      aria-label="Email"
                      type="email"
                      placeholder="jane@example.com"
                      autocomplete="off"
                      spellcheck={false}
                      data-1p-ignore
                      aria-invalid={error() === 'Enter a valid email address'}
                      class="ph-no-capture field-sizing-content max-w-full bg-transparent text-ink outline-none placeholder:text-ink-placeholder"
                      value={email()}
                      disabled={createContactMutation.isPending}
                      onInput={(event) => {
                        setEmail(event.currentTarget.value);
                        setError(undefined);
                      }}
                    />
                  </span>
                </label>
                <Show when={!props.target?.company}>
                  <EntityComposer.Properties class="px-2">
                    <ContactCompanySelect
                      mount={dialog()}
                      disabled={createContactMutation.isPending}
                      value={pickedCompany()}
                      onChange={(picked) => {
                        setPickedCompany(picked);
                        setError(undefined);
                      }}
                    />
                  </EntityComposer.Properties>
                </Show>
              </EntityComposer.Main>
              <Show when={error()}>
                {(message) => (
                  <p role="alert" class="px-2 text-sm text-failure">
                    {message()}
                  </p>
                )}
              </Show>
              <EntityComposer.Footer class="items-center">
                <EntityComposer.Submit
                  type="submit"
                  class="ml-auto"
                  hasContent={canSubmit()}
                  disabled={!canSubmit()}
                >
                  {createContactMutation.isPending
                    ? 'Creating…'
                    : 'Create Contact'}
                </EntityComposer.Submit>
              </EntityComposer.Footer>
            </EntityComposer.Root>
          </form>
        </Panel.Body>
      </Panel>
    </Dialog>
  );
}
