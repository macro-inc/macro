import { ThrownResultError } from '@core/util/result';
import EnvelopeIcon from '@phosphor/envelope.svg';
import GlobeIcon from '@phosphor/globe.svg';
import XIcon from '@phosphor/x.svg';
import { Button, Dialog, EntityComposer, Panel } from '@ui';
import { createMemo, createSignal, Show } from 'solid-js';
import { useCreateCompanyMutation } from './use-crm';

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

export function CreateCompanyModal(props: {
  open: boolean;
  onClose(): void;
  onCreated(id: string): void;
}) {
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
    reset();
    props.onClose();
  }

  function close() {
    if (createCompanyMutation.isPending) return;
    resetAndClose();
  }

  async function submit() {
    if (createCompanyMutation.isPending) return;
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
      props.onCreated(id);
    } catch (cause) {
      console.error('Failed to create company', cause);
      setError(createErrorMessage(cause));
    }
  }

  return (
    <Dialog open={props.open} onOpenChange={(open) => !open && close()}>
      <Panel hideBorder class="bg-transparent rounded-[inherit] *:max-h-[75vh]">
        <Panel.Body>
          <form
            class="h-full min-h-0"
            aria-label="New company"
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
                <Dialog.Title class="sr-only">New company</Dialog.Title>
                <EntityComposer.Title class="mb-0 min-w-0 flex-1 self-center">
                  <input
                    autofocus
                    aria-label="Company name"
                    placeholder="Company name"
                    autocomplete="off"
                    data-1p-ignore
                    aria-invalid={error() === 'Enter a company name'}
                    class="ph-no-capture w-full min-w-0 text-xl/7 font-medium outline-none bg-transparent placeholder:text-ink-placeholder"
                    value={name()}
                    disabled={createCompanyMutation.isPending}
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
                  disabled={createCompanyMutation.isPending}
                  onClick={close}
                >
                  <XIcon />
                </Button>
              </EntityComposer.Header>
              <EntityComposer.Main class="gap-4">
                <label class="flex min-w-0 items-center gap-2 px-2 text-sm">
                  <GlobeIcon
                    aria-hidden="true"
                    class="size-4 shrink-0 text-ink-muted"
                  />
                  <input
                    aria-label="Domain"
                    placeholder="Domain, like acme.com"
                    autocomplete="off"
                    spellcheck={false}
                    data-1p-ignore
                    aria-invalid={
                      error() === 'Enter a valid domain like acme.com'
                    }
                    class="ph-no-capture w-full min-w-0 bg-transparent text-ink outline-none placeholder:text-ink-placeholder"
                    value={domain()}
                    disabled={createCompanyMutation.isPending}
                    onInput={(event) => {
                      setDomain(event.currentTarget.value);
                      setError(undefined);
                    }}
                  />
                </label>
              </EntityComposer.Main>
              <Show when={error()}>
                {(message) => (
                  <p role="alert" class="px-2 text-sm text-failure">
                    {message()}
                  </p>
                )}
              </Show>
              <EntityComposer.Footer class="items-center">
                <span class="flex min-w-0 items-center gap-1.5 px-2 text-xs text-ink-muted">
                  <EnvelopeIcon class="size-4 shrink-0" />
                  <span class="truncate">
                    Emails from this domain link to the company
                  </span>
                </span>
                <EntityComposer.Submit
                  type="submit"
                  class="ml-auto"
                  hasContent={canSubmit()}
                  disabled={!canSubmit()}
                >
                  {createCompanyMutation.isPending
                    ? 'Creating…'
                    : 'Create Company'}
                </EntityComposer.Submit>
              </EntityComposer.Footer>
            </EntityComposer.Root>
          </form>
        </Panel.Body>
      </Panel>
    </Dialog>
  );
}
