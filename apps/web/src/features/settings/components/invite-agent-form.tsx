import { formatLocale, t } from '@app/lib/i18n';
import { startUiOperation } from '@app/observability/ui-operation';
import { ThrownResultError } from '@core/util/result';
import XIcon from '@icon/system/regular/x.svg';
import { type Span, Telemetry } from '@macro-inc/observability';
import type {
  ComputerSize,
  ComputerSizeSpec,
  CreateTeamAgent,
  TeamAgentQuote,
} from '@service-auth/generated/schemas';
import { Button, Dialog, Panel, RadioGroup, TextField } from '@ui';
import {
  type Accessor,
  createMemo,
  createSignal,
  For,
  type JSX,
  onCleanup,
  Show,
} from 'solid-js';
import { match } from 'ts-pattern';
import { formatBillingAmount } from '../core/format-billing-amount';
import { recommendedVoice, type VoicePickerSource } from '../core/voices';
import { AgentPortrait, type AgentPortraitSource } from './agent-portrait';
import { PriceBreakdown } from './price-breakdown';
import { VoicePicker } from './voice-picker';

export type AgentInviteSource = {
  quote: Accessor<TeamAgentQuote | undefined>;
  quoteForSize?(size: ComputerSize): TeamAgentQuote | undefined;
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
  compact?: boolean;
  closeLabel?: string;
  close(): void;
  actions: JSX.Element;
  children: JSX.Element;
}) {
  // This controlled dialog opens from a header action outside Dialog.Trigger.
  const opener = document.activeElement;
  return (
    <Dialog
      open={props.open}
      class={props.compact ? 'w-[min(480px,calc(100vw-16px))]' : undefined}
      onOpenChange={(open) => !open && props.close()}
      onCloseAutoFocus={(event) => {
        if (opener instanceof HTMLElement && opener.isConnected) {
          event.preventDefault();
          opener.focus();
        }
      }}
    >
      <Panel
        depth={2}
        class="h-auto max-h-[min(75dvh,calc(100dvh-var(--virtual-keyboard-height,0px)-var(--safe-top,0px)-48px))] text-ink rounded-xl"
      >
        <Panel.Header class="px-2 gap-1">
          <Dialog.CloseButton
            as={Button}
            variant="ghost"
            size="icon-sm"
            aria-label={props.closeLabel ?? t('agentInvite.close')}
          >
            <XIcon class="size-3.5 touch:size-6 shrink-0 pointer-events-none" />
          </Dialog.CloseButton>
          <Dialog.Title as="span" class="text-sm font-medium p-0 m-0">
            {props.title}
          </Dialog.Title>
        </Panel.Header>
        <Panel.Body scroll class="p-5">
          {props.children}
        </Panel.Body>
        <Panel.Footer class="flex flex-wrap justify-end gap-2 px-5 py-3">
          {props.actions}
        </Panel.Footer>
      </Panel>
    </Dialog>
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
  portrait?: AgentPortraitSource;
}) {
  let disposed = false;
  onCleanup(() => {
    disposed = true;
  });
  const [name, setName] = createSignal('');
  const [role, setRole] = createSignal('');
  const [personality, setPersonality] = createSignal('');
  const [chosenVoice, setChosenVoice] = createSignal<string>();
  const voice = () =>
    chosenVoice() ??
    recommendedVoice(props.voices?.choices() ?? [], personality())?.model;
  const [avatar, setAvatar] = createSignal('');
  const [portraitPending, setPortraitPending] = createSignal(false);
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
  const nameTooLong = () => Array.from(name().trim()).length > 64;
  const roleTooLong = () => Array.from(role().trim()).length > 4000;
  const personalityTooLong = () =>
    Array.from(personality().trim()).length > 4000;
  const valid = () =>
    !!name().trim() &&
    !nameTooLong() &&
    !!role().trim() &&
    !roleTooLong() &&
    !!personality().trim() &&
    !personalityTooLong() &&
    (!props.voices || !!voice());
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
      if (disposed) return;
      setSubmitted(true);
      props.onClose();
    } catch (error) {
      if (disposed) return;
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
      if (!disposed) setSubmitting(false);
    }
  };
  const price = (amount: number, quote: TeamAgentQuote) =>
    formatBillingAmount(amount, quote.currency, formatLocale());
  const sizeLabel = (size: ComputerSize) =>
    match(size)
      .with('standard', () => t('settingsBilling.standard'))
      .with('large', () => t('settingsBilling.large'))
      .with('xl', () => t('settingsBilling.xl'))
      .exhaustive();
  const intervalLabel = (quote: TeamAgentQuote) =>
    t(
      quote.interval === 'month'
        ? 'settingsBilling.month'
        : 'settingsBilling.year'
    );
  const confirmLabel = () => {
    if (busy()) return t('agentInvite.inviting');
    const quote = reviewedQuote();
    if (!quote || quote.included)
      return t('settingsBilling.inviteIncluded', { name: name().trim() });
    return t('settingsBilling.invitePriced', {
      name: name().trim(),
      price: t('agentInvite.pricePerInterval', {
        amount: price(quote.total, quote),
        interval: intervalLabel(quote),
      }),
    });
  };
  function IdentityFields() {
    return (
      <div class="space-y-4">
        <TextField
          value={name()}
          onChange={setName}
          validationState={nameTooLong() ? 'invalid' : 'valid'}
        >
          <TextField.Label>{t('agentInvite.name')}</TextField.Label>
          <TextField.Input maxLength={128} required />
          <TextField.ErrorMessage>
            {t('agentInvite.characterLimit', { count: 64 })}
          </TextField.ErrorMessage>
        </TextField>
        <TextField
          value={role()}
          onChange={setRole}
          validationState={roleTooLong() ? 'invalid' : 'valid'}
        >
          <TextField.Label>{t('agentInvite.role')}</TextField.Label>
          <TextField.TextArea maxLength={8000} required />
          <TextField.ErrorMessage>
            {t('agentInvite.characterLimit', { count: 4000 })}
          </TextField.ErrorMessage>
        </TextField>
      </div>
    );
  }
  return (
    <AgentFormSurface
      open={props.open}
      title={review() ? t('agentInvite.confirmTitle') : t('common.inviteAgent')}
      compact={review()}
      close={close}
      actions={
        <>
          <Button
            variant="ghost"
            disabled={busy()}
            onClick={() => (review() ? back() : close())}
          >
            {review() ? t('common.back') : t('common.cancel')}
          </Button>
          <Show
            when={review()}
            fallback={
              <Button
                variant="primary"
                disabled={
                  !valid() ||
                  portraitPending() ||
                  props.source.needsSubscription()
                }
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
                {t('agentInvite.reviewPrice')}
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
              class="min-w-0 max-w-full"
              onClick={confirm}
            >
              <span class="truncate">{confirmLabel()}</span>
            </Button>
          </Show>
        </>
      }
    >
      <Show when={props.source.needsSubscription()}>
        <div role="alert" class="space-y-2 mb-4 text-sm">
          <p>{t('agentInvite.needsPlan')}</p>
          <Button as="a" variant="secondary" href="/app/settings/billing">
            {t('agentInvite.goToBilling')}
          </Button>
        </div>
      </Show>
      <Show
        when={!review()}
        fallback={
          <div class="space-y-4 text-sm">
            <p class="break-words">
              {t('agentInvite.reviewDescription', {
                name: name(),
                size: sizeLabel(props.size),
              })}
            </p>
            <Show when={props.source.quoteLoading()}>
              <p role="status">{t('agentInvite.loadingPrice')}</p>
            </Show>
            <Show
              when={
                props.source.quoteError() && !props.source.needsSubscription()
              }
            >
              <div role="alert">
                {t('agentInvite.priceFailed')}{' '}
                <Button variant="secondary" onClick={props.source.reloadQuote}>
                  {t('agentInvite.tryAgain')}
                </Button>
              </div>
            </Show>
            <Show when={reviewedQuote()}>
              {(quote) => (
                <PriceBreakdown
                  currency={quote().currency}
                  interval={quote().interval}
                  total={quote().total}
                  included={quote().included}
                  items={[
                    {
                      name: t('agentInvite.agentSeat'),
                      description: name(),
                      amount: quote().seat,
                      included: quote().included,
                    },
                    {
                      name: t('settingsBilling.sizedComputer', {
                        size: sizeLabel(props.size),
                      }),
                      description: `${t('agentInvite.vcpus', { count: quote().vcpus })} · ${t('agentInvite.memory', { count: quote().memoryGb })} · ${t('agentInvite.disk', { count: quote().diskGb })}`,
                      amount: quote().computer,
                      included: quote().included,
                    },
                  ]}
                />
              )}
            </Show>
            <Show when={createFailed()}>
              <p role="alert">
                {failureMessage() || t('agentInvite.invitationFailed')}
              </p>
            </Show>
          </div>
        }
      >
        <div class="space-y-4">
          <p class="text-sm text-ink-muted">{t('agentInvite.intro')}</p>
          <Show when={props.portrait} fallback={<IdentityFields />}>
            {(source) => (
              <AgentPortrait
                name={name()}
                role={role()}
                personality={personality()}
                source={source()}
                avatar={avatar()}
                onChange={setAvatar}
                onPendingChange={setPortraitPending}
              >
                <IdentityFields />
              </AgentPortrait>
            )}
          </Show>
          <TextField
            value={personality()}
            onChange={setPersonality}
            validationState={personalityTooLong() ? 'invalid' : 'valid'}
          >
            <TextField.Label>{t('agentInvite.personality')}</TextField.Label>
            <TextField.TextArea maxLength={8000} required />
            <TextField.ErrorMessage>
              {t('agentInvite.characterLimit', { count: 4000 })}
            </TextField.ErrorMessage>
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
            aria-label={t('agentInvite.computerSize')}
          >
            <RadioGroup.Label>{t('agentInvite.computerSize')}</RadioGroup.Label>
            <For each={['standard', 'large', 'xl'] as const}>
              {(size) => (
                <RadioGroup.Item
                  value={size}
                  class="grid grid-cols-[auto_minmax(0,1fr)] gap-x-3 gap-y-1 rounded-xl border border-edge-muted p-3 data-checked:border-accent"
                >
                  <RadioGroup.ItemControl class="self-center" />
                  <div class="flex items-baseline justify-between gap-2 min-w-0">
                    <RadioGroup.ItemLabel class="capitalize text-sm font-medium">
                      {sizeLabel(size)}
                    </RadioGroup.ItemLabel>
                    <Show when={props.source.quoteForSize?.(size)}>
                      {(quote) => (
                        <span class="shrink-0 text-xs tabular-nums text-ink-muted">
                          {quote().included
                            ? t('agentInvite.included')
                            : t('agentInvite.pricePerInterval', {
                                amount: price(quote().computer, quote()),
                                interval: intervalLabel(quote()),
                              })}
                        </span>
                      )}
                    </Show>
                  </div>
                  <RadioGroup.ItemDescription class="col-start-2 flex flex-wrap gap-x-1.5 gap-y-1 text-xs text-ink-muted">
                    <Show
                      when={props.source.specsForSize(size)}
                      fallback={t('agentInvite.specsUnavailable')}
                    >
                      {(spec) => (
                        <>
                          <span class="whitespace-nowrap">
                            {t('agentInvite.vcpus', { count: spec().vcpus })}
                          </span>
                          <span class="whitespace-nowrap">
                            <span aria-hidden="true" class="mr-1.5">
                              ·
                            </span>
                            {t('agentInvite.memory', {
                              count: spec().memoryGb,
                            })}
                          </span>
                          <span class="whitespace-nowrap">
                            <span aria-hidden="true" class="mr-1.5">
                              ·
                            </span>
                            {t('agentInvite.disk', { count: spec().diskGb })}
                          </span>
                        </>
                      )}
                    </Show>
                  </RadioGroup.ItemDescription>
                </RadioGroup.Item>
              )}
            </For>
          </RadioGroup>
        </div>
      </Show>
    </AgentFormSurface>
  );
}
