import { t } from '@app/lib/i18n';
import SpinnerIcon from '@icon/system/regular/spinner.svg';
import type { ComputerSize, SizeOffer } from '@service-auth/computers';
import type { CreateTeamAgent, TeamAgent } from '@service-auth/team-agents';
import { Avatar, Button, Panel, TextField } from '@ui';
import {
  createEffect,
  createSignal,
  For,
  type JSX,
  Match,
  on,
  Show,
  Switch,
} from 'solid-js';
import { match } from 'ts-pattern';
import { ComputerSizePicker } from '../computers/components/computer-size-picker';
import { FailureNotice } from '../computers/components/failure-notice';
import { formatQuote, sizeLabel } from '../computers/core/computer-display';
import { DisabledReason } from '../computers/views/computer-setup-dialog';
import {
  type AddAgentState,
  type AddRefusal,
  AGENT_NAME_SUGGESTIONS,
} from '../core/team-agent-add';
import {
  addBlocker,
  MAX_AGENT_NAME_CHARS,
  teamAgentRequest,
} from '../core/team-agent-draft';

function refusalText(reason: AddRefusal): string {
  return match(reason)
    .with('invalid', () => t('teamAgents.invalid'))
    .with('not_enabled', () => t('teamAgents.notEnabled'))
    .with('on_trial', () => t('computers.trialBlocked'))
    .with('unavailable', () => t('teamAgents.computerUnavailable'))
    .with('in_progress', () => t('teamAgents.inviteInProgress'))
    .with('repository', () => t('teamAgents.repositoryFailed'))
    .with('unknown', () => t('teamAgents.failed'))
    .exhaustive();
}

/**
 * Add an agent teammate: a name and the computer it runs on, priced the way
 * Buy a computer prices it. Picture, voice and role come later; the agent
 * asks what to take on once it is online. The dialog stays open while the
 * agent is added and started, and every failure is shown here, with the
 * name and size kept. Renders the body and footer of the Invite to Team
 * panel.
 */
export function InviteAgentForm(props: {
  /** Above the form, e.g. the People | Agent switch. */
  header?: JSX.Element;
  /** Sizes with their price; `undefined` while loading. */
  offers: readonly SizeOffer[] | undefined;
  offersFailed: boolean;
  onRetryOffers: () => void;
  state: AddAgentState;
  purchaseKey: string;
  onCancel: () => void;
  onSubmit: (request: CreateTeamAgent, size: ComputerSize) => void;
  /** Start a computer that didn't start again, with no new charge. */
  onRetryStart: (agent: TeamAgent) => void;
  /** The name or size changed after a refusal. */
  onEdit: () => void;
  onBilling: () => void;
}) {
  const [name, setName] = createSignal('');
  const [chosenSize, setChosenSize] = createSignal<ComputerSize>();

  const adding = () => props.state.kind === 'adding';
  // A size with no room right now reads as sold out until the sizes reload.
  const noRoomSize = () =>
    props.state.kind === 'no_room' ? props.state.size : undefined;
  const offers = () =>
    props.offers?.map((offer) =>
      offer.size === noRoomSize() ? { ...offer, soldOut: true } : offer
    );
  // Until the admin picks one, the first size that is for sale.
  const size = () =>
    chosenSize() ?? offers()?.find((offer) => !offer.soldOut)?.size;
  const offer = () =>
    offers()?.find((item) => item.size === size() && !item.soldOut);

  const draft = () => ({
    name: name(),
    size: offer()?.size,
    purchaseKey: props.purchaseKey,
  });
  const trimmedName = () => name().trim();
  const initial = () => Array.from(trimmedName())[0]?.toUpperCase() ?? '?';

  const edit =
    <Value,>(set: (value: Value) => void) =>
    (value: Value) => {
      set(value);
      props.onEdit();
    };

  // Why Add can't be pressed, beside it, as the computer flow does.
  const disabledReason = () => {
    if (adding()) return undefined;
    const blocker = addBlocker(draft());
    if (!blocker) return undefined;
    return match(blocker)
      .with('name', () => t('teamAgents.nameRequired'))
      .with('name_too_long', () =>
        t('teamAgents.tooLong', { count: MAX_AGENT_NAME_CHARS })
      )
      .with('size', () =>
        props.offers
          ? t('teamAgents.noSizeForSale')
          : t('teamAgents.loadingSizes')
      )
      .exhaustive();
  };

  const price = () => {
    const chosen = offer();
    if (!chosen || chosen.quote.amount === 0) return undefined;
    return formatQuote(chosen.quote);
  };

  const addLabel = () => {
    const agentName = trimmedName() || t('teamAgents.agent');
    const amount = price();
    return amount
      ? t('teamAgents.addPriced', { name: agentName, price: amount })
      : t('teamAgents.add', { name: agentName });
  };

  const submitLabel = () =>
    match(props.state.kind)
      .with('declined', 'refunded', () => {
        const amount = price();
        return amount
          ? t('teamAgents.tryAgainPriced', { price: amount })
          : t('teamAgents.tryAgain');
      })
      .with('not_started', () => t('teamAgents.retryStart'))
      .otherwise(() => addLabel());

  const caption = () =>
    match(props.state.kind)
      .with('adding', () =>
        t('teamAgents.addingCaption', { name: trimmedName() })
      )
      .with('declined', () => t('teamAgents.declinedCaption'))
      .with('not_started', 'refunded', () => t('teamAgents.retryCaption'))
      .otherwise(() =>
        t('teamAgents.addCaption', {
          name: trimmedName() || t('teamAgents.yourAgent'),
        })
      );

  const submit = () => {
    if (adding()) return;
    const state = props.state;
    if (state.kind === 'not_started') {
      props.onRetryStart(state.agent);
      return;
    }
    const request = teamAgentRequest(draft());
    const chosen = offer();
    if (request && chosen) props.onSubmit(request, chosen.size);
  };

  // The notice sits below the sizes; bring it into view and announce it, so
  // pressing Add never looks like nothing happened.
  let notice: HTMLDivElement | undefined;
  createEffect(
    on(
      () => props.state.kind,
      (kind) => {
        if (kind === 'editing' || kind === 'adding' || !notice) return;
        notice.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
      }
    )
  );

  return (
    <>
      <Panel.Body scroll>
        <div class="flex flex-col gap-5 px-5 py-5">
          {props.header}
          <p class="text-sm text-ink-muted">{t('teamAgents.intro')}</p>

          <div class="flex flex-col gap-2">
            <TextField
              value={name()}
              onChange={edit(setName)}
              disabled={adding()}
              validationState={
                addBlocker(draft()) === 'name_too_long' ? 'invalid' : 'valid'
              }
            >
              <TextField.Label>{t('teamAgents.name')}</TextField.Label>
              <div class="flex items-center gap-3">
                <Avatar
                  size="lg"
                  class="shrink-0 bg-surface text-ink ring ring-edge-muted"
                >
                  <Avatar.Fallback>{initial()}</Avatar.Fallback>
                </Avatar>
                <TextField.Input
                  class="min-w-0 flex-1"
                  placeholder={t('teamAgents.namePlaceholder')}
                  required
                />
              </div>
              <TextField.ErrorMessage>
                {t('teamAgents.tooLong', { count: MAX_AGENT_NAME_CHARS })}
              </TextField.ErrorMessage>
            </TextField>
            <Show when={!trimmedName()}>
              <div class="flex flex-wrap items-center gap-1.5 text-xs text-ink-muted">
                <span>{t('teamAgents.nameSuggestions')}</span>
                <For each={AGENT_NAME_SUGGESTIONS}>
                  {(suggestion) => (
                    <Button
                      type="button"
                      variant="secondary"
                      size="xs"
                      class="rounded-full"
                      disabled={adding()}
                      onClick={() => edit(setName)(suggestion)}
                    >
                      {suggestion}
                    </Button>
                  )}
                </For>
              </div>
            </Show>
            <p class="text-xs text-ink-muted">
              <Show
                when={trimmedName()}
                fallback={t('teamAgents.comesLaterUnnamed')}
              >
                {(agentName) =>
                  t('teamAgents.comesLater', { name: agentName() })
                }
              </Show>
            </p>
          </div>

          <div class="flex flex-col gap-2">
            <div class="text-sm font-medium text-ink">
              {t('teamAgents.computer')}
            </div>
            <Show
              when={offers()}
              fallback={
                <Show
                  when={props.offersFailed}
                  fallback={
                    <p role="status" class="text-sm text-ink-muted">
                      {t('teamAgents.loadingSizes')}
                    </p>
                  }
                >
                  <div
                    role="alert"
                    class="flex flex-wrap items-center gap-2 text-sm text-ink-muted"
                  >
                    <span>{t('teamAgents.sizesFailed')}</span>
                    <Button
                      type="button"
                      variant="secondary"
                      size="sm"
                      onClick={() => props.onRetryOffers()}
                    >
                      {t('teamAgents.tryAgain')}
                    </Button>
                  </div>
                </Show>
              }
            >
              {(available) => (
                <ComputerSizePicker
                  offers={available()}
                  selected={size()}
                  onSelect={edit(setChosenSize)}
                />
              )}
            </Show>
            <p class="text-xs text-ink-muted">{t('teamAgents.computerHint')}</p>
          </div>

          <div ref={notice} data-add-agent-state={props.state.kind}>
            <Switch>
              <Match when={props.state.kind === 'declined'}>
                <FailureNotice
                  actions={
                    <Button
                      type="button"
                      variant="secondary"
                      size="sm"
                      onClick={() => props.onBilling()}
                    >
                      {t('teamAgents.updateCard')}
                    </Button>
                  }
                >
                  {t('teamAgents.declined')}
                </FailureNotice>
              </Match>
              <Match when={noRoomSize()}>
                {(full) => (
                  <FailureNotice>
                    {t('teamAgents.noRoom', { size: sizeLabel(full()) })}
                  </FailureNotice>
                )}
              </Match>
              <Match when={props.state.kind === 'not_started'}>
                <FailureNotice>
                  {t('teamAgents.notStarted', { name: trimmedName() })}
                </FailureNotice>
              </Match>
              <Match when={props.state.kind === 'refunded'}>
                <FailureNotice>
                  {t('teamAgents.refunded', { name: trimmedName() })}
                </FailureNotice>
              </Match>
              <Match
                when={props.state.kind === 'refused' && props.state.reason}
              >
                {(reason) => (
                  <FailureNotice>{refusalText(reason())}</FailureNotice>
                )}
              </Match>
            </Switch>
          </div>
        </div>
      </Panel.Body>
      <Panel.Footer class="flex-wrap justify-end gap-2 px-4 py-3">
        <Button
          type="button"
          variant="ghost"
          disabled={adding()}
          onClick={() => props.onCancel()}
        >
          {t('common.cancel')}
        </Button>
        <Button
          type="button"
          variant="primary"
          // While adding it keeps focus, so a phone sheet's focus trap doesn't
          // move it to the name field (and scroll back up to it) when a
          // refusal arrives; `submit` ignores presses meanwhile.
          disabled={
            !adding() &&
            props.state.kind !== 'not_started' &&
            !teamAgentRequest(draft())
          }
          aria-disabled={adding() || undefined}
          aria-busy={adding() || undefined}
          data-disabled={adding() ? '' : undefined}
          onClick={submit}
        >
          <Show when={adding()} fallback={submitLabel()}>
            <SpinnerIcon class="size-4 animate-spin" />
            {t('teamAgents.adding', { name: trimmedName() })}
          </Show>
        </Button>
        <p
          role={adding() ? 'status' : undefined}
          class="w-full text-right text-xs text-ink-muted"
        >
          <Show when={disabledReason()} fallback={caption()}>
            {(reason) => <DisabledReason>{reason()}</DisabledReason>}
          </Show>
        </p>
      </Panel.Footer>
    </>
  );
}
