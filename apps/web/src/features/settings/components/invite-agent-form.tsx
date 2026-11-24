import { t } from '@app/lib/i18n';
import { agentInitial } from '@core/user/agent-initial';
import SpinnerIcon from '@icon/system/regular/spinner.svg';
import type { ComputerSize, SizeOffer } from '@service-auth/computers';
import type { CreateTeamAgent, TeamAgent } from '@service-auth/team-agents';
import { Avatar, Button, Panel, TextField } from '@ui';
import { createEffect, createSignal, Match, on, Show, Switch } from 'solid-js';
import { match } from 'ts-pattern';
import {
  ComputerSizePicker,
  ComputerSizeSkeleton,
} from '../computers/components/computer-size-picker';
import { FailureNotice } from '../computers/components/failure-notice';
import { formatQuote, sizeLabel } from '../computers/core/computer-display';
import type { AddAgentState, AddRefusal } from '../core/team-agent-add';
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
 * Add an agent teammate: a name, shown as its initial, and the computer it
 * runs on, priced the way Buy a computer prices it. The dialog stays open
 * while the agent is added and started, and every failure is shown here, with
 * the name and size kept. Add is always enabled: with no name it marks the
 * field and moves the caret there. Renders the dialog's body and footer.
 */
export function InviteAgentForm(props: {
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
  // Add was pressed with no name: the field says it needs one.
  const [asked, setAsked] = createSignal(false);
  // Add was pressed with every size sold out.
  const [sizeAsked, setSizeAsked] = createSignal(false);
  let nameInput: HTMLInputElement | undefined;

  const adding = () => props.state.kind === 'adding';
  // A size with no room right now reads as sold out until the sizes reload.
  const noRoomSize = () =>
    props.state.kind === 'no_room' ? props.state.size : undefined;
  const offers = () =>
    props.offers?.map((offer) =>
      offer.size === noRoomSize() ? { ...offer, soldOut: true } : offer
    );
  // The chosen size while it is on sale, else the first size that is.
  const size = () => {
    const chosen = chosenSize();
    const list = offers();
    if (chosen && list?.some((item) => item.size === chosen && !item.soldOut))
      return chosen;
    return list?.find((offer) => !offer.soldOut)?.size;
  };
  const offer = () =>
    offers()?.find((item) => item.size === size() && !item.soldOut);

  const draft = () => ({
    name: name(),
    size: offer()?.size,
    purchaseKey: props.purchaseKey,
  });
  const trimmedName = () => name().trim();
  // The same letter the agent's avatar shows once it is added.
  const initial = () => agentInitial(name());
  const tooLong = () => addBlocker(draft()) === 'name_too_long';
  const nameInvalid = () => tooLong() || (asked() && !trimmedName());

  const edit =
    <Value,>(set: (value: Value) => void) =>
    (value: Value) => {
      set(value);
      props.onEdit();
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

  const submit = () => {
    if (adding()) return;
    const state = props.state;
    if (state.kind === 'not_started') {
      props.onRetryStart(state.agent);
      return;
    }
    if (addBlocker(draft()) === 'name' || tooLong()) {
      setAsked(true);
      nameInput?.focus();
      return;
    }
    if (addBlocker(draft()) === 'size') {
      // Sizes still loading or failed to load say so already.
      if (offers()) {
        setSizeAsked(true);
        notice?.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
      }
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

  const nameField = (
    <TextField
      value={name()}
      onChange={edit(setName)}
      // Read-only, not disabled, so the name keeps its ink while adding.
      readOnly={adding()}
      validationState={nameInvalid() ? 'invalid' : 'valid'}
    >
      <div class="flex flex-col gap-1.5">
        <TextField.Label>{t('teamAgents.nameIt')}</TextField.Label>
        {/* The agent's picture is its name's first letter. */}
        <div class="flex items-center gap-3">
          <Avatar
            size="lg"
            class="shrink-0 bg-surface text-ink ring ring-edge-muted"
          >
            <Avatar.Fallback>{initial()}</Avatar.Fallback>
          </Avatar>
          <TextField.Input
            ref={nameInput}
            class="min-w-0 flex-1"
            placeholder={t('teamAgents.namePlaceholder')}
            required
          />
        </div>
        <Show when={tooLong()}>
          <TextField.ErrorMessage>
            {t('teamAgents.tooLong', { count: MAX_AGENT_NAME_CHARS })}
          </TextField.ErrorMessage>
        </Show>
      </div>
    </TextField>
  );

  const computer = (
    <div class="flex flex-col gap-2">
      <div class="text-sm font-medium text-ink">
        {t('teamAgents.giveItAComputer')}
      </div>
      <Show
        when={offers()}
        fallback={
          <Show when={props.offersFailed} fallback={<ComputerSizeSkeleton />}>
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
    </div>
  );

  const noticeArea = (
    <div
      ref={notice}
      data-add-agent-state={props.state.kind}
      // With nothing to say it takes no room, not a gap under the sizes.
      class="flex flex-col gap-3 empty:hidden"
    >
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
        <Match when={sizeAsked() && offers() && !offer()}>
          <FailureNotice>{t('teamAgents.noSizeForSale')}</FailureNotice>
        </Match>
        <Match when={props.state.kind === 'refused' && props.state.reason}>
          {(reason) => <FailureNotice>{refusalText(reason())}</FailureNotice>}
        </Match>
      </Switch>
    </div>
  );

  return (
    <>
      <Panel.Body scroll>
        <div class="flex flex-col gap-5 px-5 py-5">
          {nameField}
          {computer}
          {noticeArea}
        </div>
      </Panel.Body>
      <Panel.Footer class="flex-wrap justify-end gap-2 px-5 py-3">
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
          // Always pressable: with no name it marks the field instead. While
          // adding it keeps focus, so a phone sheet's focus trap doesn't move
          // it to the name field when a refusal arrives; `submit` ignores
          // presses meanwhile.
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
      </Panel.Footer>
    </>
  );
}
