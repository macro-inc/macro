import { ThrownResultError } from '@core/util/result';
import EnvelopeIcon from '@phosphor/envelope.svg';
import XIcon from '@phosphor/x.svg';
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

// The part before the @: non-empty, no whitespace or a second @.
const LOCAL_PART_PATTERN = /^[^\s@]+$/;

function createErrorMessage(cause: unknown): string {
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

/** Companies without a domain cannot hold contacts, whose emails must match one. */
function ContactCompanySelect(props: {
  mount: HTMLElement | undefined;
  value: CompanyOption | undefined;
  onChange: (company: CompanyOption) => void;
}) {
  const suggestions = useQuickAccessCrmCompaniesQuery();
  const options = createMemo(() =>
    suggestions.companies().flatMap((company) =>
      company.domains[0]
        ? [
            {
              id: company.id,
              name: company.name,
              domain: company.domains[0].domain,
            },
          ]
        : []
    )
  );
  return (
    <CompanySelect
      id="new-contact-company"
      companies={options()}
      value={props.value}
      onChange={props.onChange}
      loading={suggestions.query.isLoading}
      mount={props.mount}
    />
  );
}

export function CreateContactModal(props: {
  /** Opens the dialog; without a company, the dialog asks for one. */
  target?: { company?: { companyId: string; domain: string } };
  onClose(): void;
  onCreated(id: string): void;
}) {
  const createContactMutation = useCreateContactMutation();
  const [name, setName] = createSignal('');
  const [localPart, setLocalPart] = createSignal('');
  const [pickedCompany, setPickedCompany] = createSignal<CompanyOption>();
  // The panel clips overflow, so the company menu mounts on the dialog itself.
  const [dialog, setDialog] = createSignal<HTMLElement>();
  const [error, setError] = createSignal<string>();
  const company = () => {
    const picked = pickedCompany();
    return (
      props.target?.company ??
      (picked && { companyId: picked.id, domain: picked.domain })
    );
  };
  const contactName = createMemo(() => name().trim());
  const emailLocalPart = createMemo(() => localPart().trim().toLowerCase());
  const canSubmit = createMemo(
    () =>
      contactName().length > 0 &&
      emailLocalPart().length > 0 &&
      company() !== undefined &&
      !createContactMutation.isPending
  );

  function reset() {
    setName('');
    setLocalPart('');
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

  // Pasting a full address is common — strip our fixed suffix so
  // "jane@acme.com" collapses to "jane" instead of failing validation.
  function handleLocalPartInput(value: string) {
    const domain = company()?.domain;
    const suffix = domain ? `@${domain}` : undefined;
    setLocalPart(
      suffix && value.toLowerCase().endsWith(suffix)
        ? value.slice(0, -suffix.length)
        : value
    );
    setError(undefined);
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
    if (!LOCAL_PART_PATTERN.test(emailLocalPart())) {
      setError('Enter the part of the email before the @');
      return;
    }

    setError(undefined);
    try {
      const { id } = await createContactMutation.mutateAsync({
        companyId: target.companyId,
        name: contactName(),
        email: `${emailLocalPart()}@${target.domain}`,
      });
      resetAndClose();
      props.onCreated(id);
    } catch (cause) {
      console.error('Failed to create contact', cause);
      setError(createErrorMessage(cause));
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
              void submit();
            }}
            onKeyDown={(event) => {
              if (
                event.key === 'Enter' &&
                (event.metaKey || event.ctrlKey) &&
                !event.isComposing
              ) {
                event.preventDefault();
                event.stopPropagation();
                void submit();
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
                      placeholder="jane"
                      autocomplete="off"
                      spellcheck={false}
                      data-1p-ignore
                      aria-invalid={
                        error() === 'Enter the part of the email before the @'
                      }
                      class="ph-no-capture field-sizing-content max-w-full bg-transparent text-ink outline-none placeholder:text-ink-placeholder"
                      value={localPart()}
                      disabled={createContactMutation.isPending}
                      onInput={(event) =>
                        handleLocalPartInput(event.currentTarget.value)
                      }
                    />
                    <span class="shrink-0 select-none text-ink-muted">
                      @{company()?.domain ?? 'company domain'}
                    </span>
                  </span>
                </label>
                <Show when={!props.target?.company}>
                  <EntityComposer.Properties class="px-2">
                    <ContactCompanySelect
                      mount={dialog()}
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
