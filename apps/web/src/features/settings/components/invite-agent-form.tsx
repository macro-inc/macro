import { MobileDrawer } from '@components/app/mobile/MobileDrawer';
import { isMobile } from '@core/mobile/isMobile';
import type {
  ComputerSize,
  CreateTeamAgent,
  TeamAgentQuote,
} from '@service-auth/generated/schemas';
import { ActionDialogShell, Button, Dialog, RadioGroup, TextField } from '@ui';
import { type Accessor, createSignal, For, type JSX, Show } from 'solid-js';

export type AgentInviteSource = {
  quote: Accessor<TeamAgentQuote | undefined>;
  quoteForSize(size: ComputerSize): TeamAgentQuote | undefined;
  quoteLoading: Accessor<boolean>;
  quoteError: Accessor<boolean>;
  reloadQuote(): void;
  pending: Accessor<boolean>;
  error: Accessor<boolean>;
  create(request: CreateTeamAgent): Promise<unknown>;
};

function InviteSurface(props: {
  open: boolean;
  title: string;
  close(): void;
  actions: JSX.Element;
  children: JSX.Element;
}) {
  const opener = document.activeElement;
  const restoreFocus = (event: Event) => {
    event.preventDefault();
    if (opener instanceof HTMLElement && opener.isConnected) opener.focus();
  };
  return (
    <Show
      when={isMobile()}
      fallback={
        <Dialog
          open={props.open}
          onOpenChange={(open) => !open && props.close()}
          position="center"
          class="w-120"
          onCloseAutoFocus={restoreFocus}
        >
          <ActionDialogShell>
            <ActionDialogShell.Body>
              <Dialog.Title class="text-lg font-semibold mb-4">
                {props.title}
              </Dialog.Title>
              {props.children}
            </ActionDialogShell.Body>
            <ActionDialogShell.Footer>{props.actions}</ActionDialogShell.Footer>
          </ActionDialogShell>
        </Dialog>
      }
    >
      <MobileDrawer
        open={props.open}
        onOpenChange={(open) => !open && props.close()}
        side="bottom"
        restoreFocus
        onFinalFocus={restoreFocus}
      >
        <MobileDrawer.Portal>
          <MobileDrawer.Overlay />
          <MobileDrawer.Content maxHeight={95}>
            <MobileDrawer.Handle />
            <MobileDrawer.Title class="px-5 pb-3 text-lg font-semibold">
              {props.title}
            </MobileDrawer.Title>
            <div class="shrink-0 flex justify-end gap-2 px-5 pb-3">
              {props.actions}
            </div>
            <MobileDrawer.ScrollBody>
              <div class="space-y-5 px-5 pb-6">{props.children}</div>
            </MobileDrawer.ScrollBody>
          </MobileDrawer.Content>
        </MobileDrawer.Portal>
      </MobileDrawer>
    </Show>
  );
}

/** Shared form and purchase policy, supplied by the host's query adapter. */
export function InviteAgentForm(props: {
  open: boolean;
  onClose(): void;
  size: ComputerSize;
  setSize(size: ComputerSize): void;
  source: AgentInviteSource;
}) {
  const [name, setName] = createSignal('');
  const [role, setRole] = createSignal('');
  const [personality, setPersonality] = createSignal('');
  const [avatar, setAvatar] = createSignal('');
  const [review, setReview] = createSignal(false);
  const [submitting, setSubmitting] = createSignal(false);
  const [submitted, setSubmitted] = createSignal(false);
  const [createFailed, setCreateFailed] = createSignal(false);
  const avatarValid = () => {
    if (!avatar().trim()) return true;
    try {
      return new URL(avatar().trim()).protocol === 'https:';
    } catch {
      return false;
    }
  };
  const valid = () =>
    !!name().trim() &&
    !!role().trim() &&
    !!personality().trim() &&
    avatarValid();
  const busy = () => submitting() || props.source.pending();
  const close = () => {
    if (!busy()) props.onClose();
  };
  const confirm = async () => {
    if (
      createFailed() ||
      busy() ||
      submitted() ||
      !review() ||
      !valid() ||
      !props.source.quote() ||
      props.source.quoteLoading() ||
      props.source.quoteError()
    )
      return;
    setSubmitting(true);
    setCreateFailed(false);
    try {
      await props.source.create({
        name: name().trim(),
        jobDescription: role().trim(),
        personality: personality().trim(),
        size: props.size,
        avatarUrl: avatar().trim() || undefined,
      });
      setSubmitted(true);
      props.onClose();
    } catch {
      setCreateFailed(true);
    } finally {
      setSubmitting(false);
    }
  };
  const price = (amount: number, quote: TeamAgentQuote) =>
    new Intl.NumberFormat(undefined, {
      style: 'currency',
      currency: quote.currency,
    }).format(amount / 100);
  return (
    <InviteSurface
      open={props.open}
      title={review() ? 'Confirm agent invitation' : 'Invite agent'}
      close={close}
      actions={
        <>
          <Button
            variant="ghost"
            disabled={busy()}
            onClick={() => (review() ? setReview(false) : close())}
          >
            {review() ? 'Back' : 'Cancel'}
          </Button>
          <Show
            when={review()}
            fallback={
              <Button
                variant="primary"
                disabled={!valid()}
                onClick={() => setReview(true)}
              >
                Review price
              </Button>
            }
          >
            <Button
              variant="primary"
              disabled={
                busy() ||
                createFailed() ||
                submitted() ||
                !props.source.quote() ||
                props.source.quoteLoading() ||
                props.source.quoteError()
              }
              onClick={confirm}
            >
              {busy() ? 'Inviting…' : 'Confirm and invite'}
            </Button>
          </Show>
        </>
      }
    >
      <Show
        when={!review()}
        fallback={
          <div class="space-y-4 text-sm">
            <p class="break-words">
              Invite <strong>{name()}</strong> with a{' '}
              <span class="capitalize">{props.size}</span> computer.
            </p>
            <Show when={props.source.quoteLoading()}>
              <p role="status">Loading price…</p>
            </Show>
            <Show when={props.source.quoteError()}>
              <div role="alert">
                Couldn't load the price.{' '}
                <Button variant="secondary" onClick={props.source.reloadQuote}>
                  Try again
                </Button>
              </div>
            </Show>
            <Show when={props.source.quote()}>
              {(quote) => (
                <>
                  <dl class="grid grid-cols-2 gap-3">
                    <dt>Agent seat</dt>
                    <dd class="text-right">{price(quote().seat, quote())}</dd>
                    <dt>Computer</dt>
                    <dd class="text-right">
                      {price(quote().computer, quote())}
                    </dd>
                    <dt class="font-semibold">Total per {quote().interval}</dt>
                    <dd class="text-right font-semibold">
                      {price(quote().total, quote())}
                    </dd>
                  </dl>
                  <p class="text-ink-muted">
                    The seat and computer are added to your team's subscription
                    together.
                  </p>
                </>
              )}
            </Show>
            <Show when={createFailed() || props.source.error()}>
              <p role="alert">
                Couldn't confirm the invitation. Check the members list before
                trying again.
              </p>
            </Show>
          </div>
        }
      >
        <div class="space-y-4">
          <TextField value={name()} onChange={setName}>
            <TextField.Label>Name</TextField.Label>
            <TextField.Input maxLength={100} required />
          </TextField>
          <TextField value={role()} onChange={setRole}>
            <TextField.Label>Role / job description</TextField.Label>
            <TextField.TextArea required />
          </TextField>
          <TextField value={personality()} onChange={setPersonality}>
            <TextField.Label>Personality</TextField.Label>
            <TextField.TextArea required />
          </TextField>
          <RadioGroup
            value={props.size}
            onChange={(value) => {
              if (value === 'standard' || value === 'large' || value === 'xl')
                props.setSize(value);
            }}
            aria-label="Computer size"
          >
            <RadioGroup.Label>Computer size</RadioGroup.Label>
            <For each={['standard', 'large', 'xl'] as const}>
              {(size) => (
                <RadioGroup.Item value={size} class="flex items-center gap-2">
                  <RadioGroup.ItemControl />
                  <RadioGroup.ItemLabel class="capitalize">
                    {size === 'xl' ? 'XL' : size}
                  </RadioGroup.ItemLabel>
                  <RadioGroup.ItemDescription class="text-xs text-ink-muted">
                    <Show
                      when={props.source.quoteForSize(size)}
                      fallback="Specifications unavailable"
                    >
                      {(quote) => (
                        <>
                          {quote().vcpus} vCPUs · {quote().memoryGb} GB RAM ·{' '}
                          {quote().diskGb} GB disk
                        </>
                      )}
                    </Show>
                  </RadioGroup.ItemDescription>
                </RadioGroup.Item>
              )}
            </For>
          </RadioGroup>
          <TextField
            value={avatar()}
            onChange={setAvatar}
            validationState={avatarValid() ? 'valid' : 'invalid'}
          >
            <TextField.Label>Avatar URL (optional)</TextField.Label>
            <TextField.Input type="url" placeholder="https://…" />
            <TextField.ErrorMessage>
              Enter an HTTPS image URL.
            </TextField.ErrorMessage>
          </TextField>
        </div>
      </Show>
    </InviteSurface>
  );
}
