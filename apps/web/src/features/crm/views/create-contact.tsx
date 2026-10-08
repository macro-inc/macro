import { ThrownResultError } from '@core/util/result';
import UserPlusIcon from '@phosphor/user-plus.svg';
import XIcon from '@phosphor/x.svg';
import { Button, Dialog, Panel } from '@ui';
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
      portalScope="local"
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

  async function handleSubmit(event: SubmitEvent) {
    event.preventDefault();
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
      class="w-120"
    >
      <Panel depth={2} class="rounded-xl *:max-h-[75vh]">
        <Panel.Body>
          <form class="flex flex-col gap-4 p-5" onSubmit={handleSubmit}>
            <div class="flex items-center gap-1">
              <div class="flex-1" />
              <Dialog.CloseButton
                as={Button}
                size="icon-sm"
                label="Close"
                tabIndex={-1}
                disabled={createContactMutation.isPending}
              >
                <XIcon />
              </Dialog.CloseButton>
            </div>

            <div class="flex flex-col gap-4">
              <div class="flex items-center gap-2 px-2">
                <Dialog.Title class="sr-only">Add a contact</Dialog.Title>
                <label for="new-contact-name" class="sr-only">
                  Name
                </label>
                <UserPlusIcon
                  aria-hidden="true"
                  class="size-5 shrink-0 text-ink-placeholder"
                />
                <input
                  id="new-contact-name"
                  type="text"
                  value={name()}
                  onInput={(event) => {
                    setName(event.currentTarget.value);
                    setError(undefined);
                  }}
                  placeholder="Contact name"
                  autocomplete="off"
                  data-1p-ignore
                  aria-invalid={error() === 'Enter a name'}
                  class="h-10 w-full border-none bg-transparent px-0 text-xl font-medium text-ink outline-none placeholder:text-ink-placeholder focus:ring-0"
                />
              </div>

              <Show when={!props.target?.company}>
                <div class="flex flex-col gap-2 px-2">
                  <label
                    for="new-contact-company"
                    class="text-xs font-medium text-ink-muted"
                  >
                    Company
                  </label>
                  <ContactCompanySelect
                    value={pickedCompany()}
                    onChange={(picked) => {
                      setPickedCompany(picked);
                      setError(undefined);
                    }}
                  />
                </div>
              </Show>

              <div class="flex flex-col gap-2 px-2">
                <label
                  for="new-contact-email"
                  class="text-xs font-medium text-ink-muted"
                >
                  Email
                </label>
                <div class="flex h-9 w-full items-center rounded-lg border border-edge-muted focus-within:border-edge">
                  <input
                    id="new-contact-email"
                    type="text"
                    value={localPart()}
                    onInput={(event) =>
                      handleLocalPartInput(event.currentTarget.value)
                    }
                    placeholder="jane"
                    autocomplete="off"
                    spellcheck={false}
                    data-1p-ignore
                    aria-invalid={
                      error() === 'Enter the part of the email before the @'
                    }
                    class="h-full min-w-0 flex-1 border-none bg-transparent pl-3 text-sm text-ink outline-none placeholder:text-ink-placeholder focus:ring-0"
                  />
                  <span class="shrink-0 select-none pr-3 pl-0.5 text-sm text-ink-placeholder">
                    @{company()?.domain ?? 'company domain'}
                  </span>
                </div>
              </div>
            </div>

            <Show when={error()}>
              {(message) => (
                <div class="border-y border-edge-muted p-2">
                  <div class="px-3 py-2 text-sm text-failure-ink" role="alert">
                    {message()}
                  </div>
                </div>
              )}
            </Show>

            <div class="flex shrink-0 items-end justify-end gap-2">
              <Button
                type="submit"
                variant="strong"
                depth={3}
                disabled={!canSubmit()}
              >
                {createContactMutation.isPending ? 'Adding…' : 'Add Contact'}
              </Button>
            </div>
          </form>
        </Panel.Body>
      </Panel>
    </Dialog>
  );
}
