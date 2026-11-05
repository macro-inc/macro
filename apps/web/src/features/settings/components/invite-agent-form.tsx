import { startUiOperation } from '@app/observability/ui-operation';
import { MobileDrawer } from '@components/app/mobile/MobileDrawer';
import { isMobile } from '@core/mobile/isMobile';
import { ThrownResultError } from '@core/util/result';
import { type Span, Telemetry } from '@macro-inc/observability';
import type {
  ComputerSize,
  ComputerSizeSpec,
  CreateTeamAgent,
  TeamAgentQuote,
} from '@service-auth/generated/schemas';
import { ActionDialogShell, Button, Dialog, RadioGroup, TextField } from '@ui';
import {
  type Accessor,
  createMemo,
  createSignal,
  For,
  type JSX,
  Show,
} from 'solid-js';
import { recommendedVoice, type VoicePickerSource } from '../core/voices';
import { VoicePicker } from './voice-picker';

export type AgentInviteSource = {
  quote: Accessor<TeamAgentQuote | undefined>;
  specsForSize(size: ComputerSize): ComputerSizeSpec | undefined;
  needsSubscription: Accessor<boolean>;
  quoteLoading: Accessor<boolean>;
  quoteError: Accessor<boolean>;
  reloadQuote(): void;
  pending: Accessor<boolean>;
  create(request: CreateTeamAgent, parentSpan?: Span): Promise<unknown>;
};

export function AgentFormSurface(props: {
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
  teamId: string;
  onClose(): void;
  size: ComputerSize;
  setSize(size: ComputerSize): void;
  source: AgentInviteSource;
  voices?: VoicePickerSource;
}) {
  const [name, setName] = createSignal('');
  const [role, setRole] = createSignal('');
  const [personality, setPersonality] = createSignal('');
  const [chosenVoice, setChosenVoice] = createSignal<string>();
  const voice = () =>
    chosenVoice() ??
    recommendedVoice(props.voices?.choices() ?? [], personality())?.model;
  const [avatar, setAvatar] = createSignal('');
  const [review, setReview] = createSignal(false);
  const [submitting, setSubmitting] = createSignal(false);
  const [submitted, setSubmitted] = createSignal(false);
  const [createFailed, setCreateFailed] = createSignal(false);
  const [quoteChanged, setQuoteChanged] = createSignal(false);
  // Freeze the first quote shown in this review until Back, including across refetches.
  const reviewedQuote = createMemo<TeamAgentQuote | undefined>((previous) => {
    if (!review()) return undefined;
    if (previous) return previous;
    if (props.source.quoteLoading() || props.source.quoteError())
      return undefined;
    const quote = props.source.quote();
    return quote ? { ...quote } : undefined;
  });
  const [failureMessage, setFailureMessage] = createSignal<string>();
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
    (!props.voices || !!voice()) &&
    avatarValid();
  const busy = () => submitting() || props.source.pending();
  const close = () => {
    if (!busy()) props.onClose();
  };
  const back = () => {
    setReview(false);
    if (!quoteChanged()) return;
    setQuoteChanged(false);
    setCreateFailed(false);
    setFailureMessage(undefined);
    props.source.reloadQuote();
  };
  const confirm = async () => {
    const quote = reviewedQuote();
    if (
      props.source.needsSubscription() ||
      createFailed() ||
      busy() ||
      submitted() ||
      !review() ||
      !valid() ||
      !quote ||
      props.source.quoteLoading() ||
      props.source.quoteError()
    )
      return;
    setSubmitting(true);
    setCreateFailed(false);
    setFailureMessage(undefined);
    try {
      await Telemetry.span('team-agent.invite.submit', async (span) => {
        span.setAttr('team.id', props.teamId);
        span.setAttr('computer.size', props.size);
        try {
          return await props.source.create(
            {
              name: name().trim(),
              jobDescription: role().trim(),
              personality: personality().trim(),
              voice: voice(),
              size: props.size,
              expectedIncluded: quote.included,
              avatarUrl: avatar().trim() || undefined,
            },
            span
          );
        } catch (error) {
          span.error('Agent invitation failed');
          throw error;
        }
      });
      setSubmitted(true);
      props.onClose();
    } catch (error) {
      if (error instanceof ThrownResultError) {
        setQuoteChanged(
          error.errors.some((reason) => reason.code === 'quote_changed')
        );
        setFailureMessage(
          error.errors.find(
            (reason) =>
              reason.code === 'repository_creation_failed' ||
              reason.code === 'quote_changed'
          )?.message
        );
      }
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
    <AgentFormSurface
      open={props.open}
      title={review() ? 'Confirm agent invitation' : 'Invite agent'}
      close={close}
      actions={
        <>
          <Button
            variant="ghost"
            disabled={busy()}
            onClick={() => (review() ? back() : close())}
          >
            {review() ? 'Back' : 'Cancel'}
          </Button>
          <Show
            when={review()}
            fallback={
              <Button
                variant="primary"
                disabled={!valid() || props.source.needsSubscription()}
                onClick={(event) => {
                  const operation = startUiOperation(
                    'team-agent.review-price',
                    {
                      event,
                      attributes: {
                        'team.id': props.teamId,
                        'computer.size': props.size,
                      },
                    }
                  );
                  setChosenVoice(voice());
                  setReview(true);
                  operation.afterPaint();
                }}
              >
                Review price
              </Button>
            }
          >
            <Button
              variant="primary"
              disabled={
                props.source.needsSubscription() ||
                busy() ||
                createFailed() ||
                submitted() ||
                !reviewedQuote() ||
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
      <Show when={props.source.needsSubscription()}>
        <div role="alert" class="space-y-2 mb-4 text-sm">
          <p>
            Your team needs an active plan before you can invite an agent. Ask
            the team owner to activate a plan in Billing.
          </p>
          <Button as="a" variant="secondary" href="/app/settings/billing">
            Go to billing
          </Button>
        </div>
      </Show>
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
            <Show
              when={
                props.source.quoteError() && !props.source.needsSubscription()
              }
            >
              <div role="alert">
                Couldn't load the price.{' '}
                <Button variant="secondary" onClick={props.source.reloadQuote}>
                  Try again
                </Button>
              </div>
            </Show>
            <Show when={reviewedQuote()}>
              {(quote) => (
                <Show
                  when={!quote().included}
                  fallback={<p class="font-semibold">Included for Macro</p>}
                >
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
                </Show>
              )}
            </Show>
            <Show when={createFailed()}>
              <p role="alert">
                {failureMessage() ||
                  "Couldn't confirm the invitation. Check the members list before trying again."}
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
          <Show when={props.voices}>
            {(source) => (
              <VoicePicker
                source={source()}
                value={voice()}
                onChange={setChosenVoice}
                disabled={busy()}
              />
            )}
          </Show>
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
                      when={props.source.specsForSize(size)}
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
    </AgentFormSurface>
  );
}
