import { useSplitLayout } from '@components/app/split-layout/layout';
import { useFocusLock } from '@core/util/createControlledOpenSignal';
import { ThrownResultError } from '@core/util/result';
import BuildingsIcon from '@phosphor/buildings.svg';
import XIcon from '@phosphor/x.svg';
import { useCreateCompanyMutation } from '@queries/crm/companies';
import { Button, Dialog, Panel } from '@ui';
import { createMemo, createSignal, Show } from 'solid-js';

const [createCompanyModalOpen, setCreateCompanyModalOpen] = createSignal(false);
const createCompanyModalFocusLock = useFocusLock('create-company');

export function openCreateCompanyModal() {
  createCompanyModalFocusLock.acquire();
  setCreateCompanyModalOpen(true);
}

// Light client-side check for a bare domain like "acme.com"; the server
// enforces the real rules (no scheme/path/@, not a generic email provider).
const DOMAIN_PATTERN = /^[a-z0-9][a-z0-9.-]*\.[a-z]{2,}$/i;

function createErrorMessage(cause: unknown): string {
  if (cause instanceof ThrownResultError) {
    if (cause.errors.some((e) => e.code === 'CONFLICT')) {
      return 'A company with this domain already exists.';
    }
    if (cause.errors.some((e) => e.code === 'FORBIDDEN')) {
      return "CRM isn't enabled for your team.";
    }
  }
  return 'Failed to create company. Try again.';
}

export function CreateCompanyModal() {
  const { replaceOrInsertSplit } = useSplitLayout();
  const createCompanyMutation = useCreateCompanyMutation();
  const [name, setName] = createSignal('');
  const [domain, setDomain] = createSignal('');
  const [error, setError] = createSignal<string>();
  const companyName = createMemo(() => name().trim());
  const companyDomain = createMemo(() => domain().trim().toLowerCase());
  const canSubmit = createMemo(
    () =>
      companyName().length > 0 &&
      companyDomain().length > 0 &&
      !createCompanyMutation.isPending
  );

  function reset() {
    setName('');
    setDomain('');
    setError(undefined);
  }

  function resetAndClose() {
    createCompanyModalFocusLock.release();
    reset();
    setCreateCompanyModalOpen(false);
  }

  function close() {
    if (createCompanyMutation.isPending) return;
    resetAndClose();
  }

  async function handleSubmit(event: SubmitEvent) {
    event.preventDefault();
    if (!companyName()) {
      setError('Enter a company name');
      return;
    }
    if (!DOMAIN_PATTERN.test(companyDomain())) {
      setError('Enter a valid domain like acme.com');
      return;
    }

    setError(undefined);
    try {
      const { id } = await createCompanyMutation.mutateAsync({
        name: companyName(),
        domain: companyDomain(),
      });
      resetAndClose();
      replaceOrInsertSplit({ type: 'company', id });
    } catch (cause) {
      console.error('Failed to create company', cause);
      setError(createErrorMessage(cause));
    }
  }

  return (
    <Dialog
      open={createCompanyModalOpen()}
      onOpenChange={(open) => !open && close()}
      class="w-120"
    >
      <Panel depth={2} class="rounded-xl *:max-h-[75vh]">
        <Panel.Body>
          <form class="flex flex-col gap-4 p-4" onSubmit={handleSubmit}>
            <div class="flex items-center gap-1">
              <div class="flex-1" />
              <Dialog.CloseButton
                as={Button}
                size="icon-sm"
                label="Close"
                tabIndex={-1}
                disabled={createCompanyMutation.isPending}
              >
                <XIcon />
              </Dialog.CloseButton>
            </div>

            <div class="flex flex-col gap-4">
              <div class="flex items-center gap-2 px-2">
                <Dialog.Title class="sr-only">Create a company</Dialog.Title>
                <label for="new-company-name" class="sr-only">
                  Name
                </label>
                <BuildingsIcon
                  aria-hidden="true"
                  class="size-5 shrink-0 text-ink-placeholder"
                />
                <input
                  id="new-company-name"
                  type="text"
                  value={name()}
                  onInput={(event) => {
                    setName(event.currentTarget.value);
                    setError(undefined);
                  }}
                  placeholder="Company name"
                  autocomplete="off"
                  data-1p-ignore
                  aria-invalid={error() === 'Enter a company name'}
                  class="h-10 w-full border-none bg-transparent px-0 text-xl font-medium text-ink outline-none placeholder:text-ink-placeholder focus:ring-0"
                />
              </div>

              <div class="flex flex-col gap-2 px-2">
                <label
                  for="new-company-domain"
                  class="text-xs font-medium text-ink-muted"
                >
                  Domain
                </label>
                <input
                  id="new-company-domain"
                  type="text"
                  value={domain()}
                  onInput={(event) => {
                    setDomain(event.currentTarget.value);
                    setError(undefined);
                  }}
                  placeholder="acme.com"
                  autocomplete="off"
                  spellcheck={false}
                  data-1p-ignore
                  aria-invalid={
                    error() === 'Enter a valid domain like acme.com'
                  }
                  class="h-9 w-full rounded-lg border border-edge-muted bg-transparent px-3 text-sm text-ink outline-none placeholder:text-ink-placeholder focus:border-edge"
                />
                <span class="text-xs text-ink-extra-muted">
                  Emails with this domain will be linked to the company.
                </span>
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
                variant={canSubmit() ? 'accent' : 'ghost'}
                depth={3}
                class="rounded-lg border-0"
                disabled={!canSubmit()}
              >
                {createCompanyMutation.isPending
                  ? 'Creating…'
                  : 'Create Company'}
              </Button>
            </div>
          </form>
        </Panel.Body>
      </Panel>
    </Dialog>
  );
}
