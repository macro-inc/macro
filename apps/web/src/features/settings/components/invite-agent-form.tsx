import { t } from '@app/lib/i18n';
import { fireAndForget } from '@core/util/fireAndForget';
import SpinnerIcon from '@icon/system/regular/spinner.svg';
import type { ComputerSize, SizeOffer } from '@service-auth/computers';
import type { CreateTeamAgent, TeamAgent } from '@service-auth/team-agents';
import { Avatar, Button, TextField } from '@ui';
import {
  createEffect,
  createSignal,
  type JSX,
  Match,
  on,
  onCleanup,
  Show,
  Switch,
} from 'solid-js';
import { match } from 'ts-pattern';
import {
  ComputerSizePicker,
  ComputerSizeSkeleton,
} from '../computers/components/computer-size-picker';
import { FailureNotice } from '../computers/components/failure-notice';
import { formatQuote, sizeLabel } from '../computers/core/computer-display';
import type { AddAgentState, AddRefusal } from '../core/team-agent-add';
import {
  type AgentHost,
  addBlocker,
  type HostInvite,
  hostInvite,
  MAX_AGENT_NAME_CHARS,
  teamAgentRequest,
} from '../core/team-agent-draft';
import { AgentInviteLayoutA } from './agent-invite-layout-a';
import { TeammateCommand } from './teammate-command';

/**
 * The radio name every computer choice shares, sizes to buy and the
 * inviter's own computers alike, so exactly one is picked.
 */
export const AGENT_COMPUTER_CHOICE = 'agent-computer';

/** The longest name the Add button spells out before the machine's name. */
const ADD_LABEL_NAME_CHARS = 24;

function shortenedName(name: string): string {
  const characters = Array.from(name);
  if (characters.length <= ADD_LABEL_NAME_CHARS) return name;
  return `${characters
    .slice(0, ADD_LABEL_NAME_CHARS - 1)
    .join('')
    .trimEnd()}…`;
}

/** Names a part of the computer list; not itself a choice. */
function ChoiceGroupLabel(props: { children: JSX.Element }) {
  return (
    <div class="pt-1 text-xs font-medium text-ink-muted">{props.children}</div>
  );
}

function refusalText(reason: AddRefusal): string {
  return match(reason)
    .with('invalid', () => t('teamAgents.invalid'))
    .with('not_enabled', () => t('teamAgents.notEnabled'))
    .with('on_trial', () => t('computers.trialBlocked'))
    .with('unavailable', () => t('teamAgents.computerUnavailable'))
    .with('in_progress', () => t('teamAgents.inviteInProgress'))
    .with('repository', () => t('teamAgents.repositoryFailed'))
    .with('host_not_eligible', () => t('teammateHosts.hostNotEligible'))
    .with('self_hosted_not_enabled', () =>
      t('teammateHosts.selfHostedNotEnabled')
    )
    .with('unknown', () => t('teamAgents.failed'))
    .exhaustive();
}

/**
 * Add an agent teammate: a name, its picture, and the computer it runs on,
 * priced the way Buy a computer prices it. The dialog stays open while the
 * agent is added and started, and every failure is shown here, with the name
 * and size kept. Add is enabled unless neither the sizes nor the inviter's
 * computers loaded: with no name it marks the field and moves the caret
 * there. Renders the dialog's body and footer through a
 * layout (`AgentInviteLayoutA`).
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
  /** Beside the name, in place of its initial (a face the viewer can edit). */
  avatar?: (initial: () => string) => JSX.Element;
  /**
   * Before Add sends the request: what the picture adds to it (its URL and
   * recipe). It may fail softly by returning less; it must not throw.
   */
  prepareAvatar?: () => Promise<Partial<CreateTeamAgent> | undefined>;
  /**
   * The inviter's own computers, listed under Your computers in the same
   * choice as the sizes. Rows share the radio name `AGENT_COMPUTER_CHOICE`,
   * check the host `selected` names and call `onSelect` when picked. Left
   * out, only sizes to buy are offered.
   */
  hosts?: (choice: {
    selected: () => string | undefined;
    onSelect: (host: AgentHost) => void;
  }) => JSX.Element;
  /** The inviter's computers failed to load; with the sizes failed too, one error says so. */
  hostsFailed?: boolean;
  onRetryHosts?: () => void;
  /**
   * Under the list while one of the inviter's computers is picked; `name` is
   * empty until the agent is named.
   */
  hostNotice?: (host: AgentHost, name: string) => JSX.Element;
  /** Add with one of the inviter's computers picked: nothing is bought. */
  onSubmitHost?: (invite: HostInvite) => void;
  /**
   * More choices for the new agent, under the computer list (an email
   * address of its own). The caller owns their state and adds them to the
   * request it sends.
   */
  options?: JSX.Element;
}) {
  const [name, setName] = createSignal('');
  const [chosenSize, setChosenSize] = createSignal<ComputerSize>();
  // One of the inviter's computers, in place of a size to buy.
  const [host, setHost] = createSignal<AgentHost>();
  const chooseSize = (chosen: ComputerSize) => {
    setHost(undefined);
    setChosenSize(chosen);
  };
  // Picking a computer shows what hosting there means under the list; bring
  // it into view, since on a phone it starts below the fold.
  const chooseHost = (picked: AgentHost) => {
    setHost(picked);
    notice?.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
  };
  // Add was pressed with no name: the field says it needs one.
  const [asked, setAsked] = createSignal(false);
  // Add was pressed with every size sold out.
  const [sizeAsked, setSizeAsked] = createSignal(false);
  // The picture is being prepared, before the request goes out.
  const [preparing, setPreparing] = createSignal(false);
  let disposed = false;
  onCleanup(() => {
    disposed = true;
  });
  let nameInput: HTMLInputElement | undefined;

  const adding = () => props.state.kind === 'adding' || preparing();
  // Neither the sizes nor the inviter's computers loaded: nothing to pick.
  const nothingLoaded = () =>
    props.offersFailed && (!props.hosts || !!props.hostsFailed);
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
  const initial = () => Array.from(trimmedName())[0]?.toUpperCase() ?? '?';
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
    const picked = host();
    // The machine must stay on the button, so a long name gives way.
    if (picked)
      return t('teamAgents.addOn', {
        name: shortenedName(agentName),
        host: picked.name,
      });
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

  /**
   * Adds the picture's fields to `request`, then sends it; with no picture to
   * prepare it sends right away. Nothing is sent once the form has gone.
   */
  const withPicture = async <Request extends Partial<CreateTeamAgent>>(
    request: Request,
    sendRequest: (request: Request) => void
  ) => {
    if (!props.prepareAvatar) {
      sendRequest(request);
      return;
    }
    setPreparing(true);
    const avatar = await props.prepareAvatar();
    if (disposed) return;
    setPreparing(false);
    if (!avatar) return;
    sendRequest({ ...request, ...avatar });
  };

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
    const picked = host();
    if (picked) {
      const invite = hostInvite(draft(), picked);
      if (invite)
        fireAndForget(
          withPicture(invite, (ready) => props.onSubmitHost?.(ready)),
          'team-agent.add'
        );
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
    if (request && chosen)
      fireAndForget(
        withPicture(request, (ready) => props.onSubmit(ready, chosen.size)),
        'team-agent.add'
      );
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
    <AgentInviteLayoutA
      name={
        <TextField
          value={name()}
          onChange={edit(setName)}
          // Read-only, not disabled, so the name keeps its ink while adding.
          readOnly={adding()}
          validationState={nameInvalid() ? 'invalid' : 'valid'}
        >
          {/* The face leads, top left; the name's prompt is its label. */}
          <div class="flex items-start gap-4">
            <fieldset disabled={adding()} class="contents">
              <Show
                when={props.avatar}
                fallback={
                  <span class="block size-16 shrink-0">
                    <Avatar
                      size="fill"
                      class="bg-surface text-ink ring ring-edge-muted"
                    >
                      <Avatar.Fallback class="text-xl">
                        {initial()}
                      </Avatar.Fallback>
                    </Avatar>
                  </span>
                }
              >
                {(avatar) => avatar()(initial)}
              </Show>
            </fieldset>
            <div class="flex min-w-0 flex-1 flex-col gap-1.5 pt-1.5">
              <TextField.Label>{t('teamAgents.nameIt')}</TextField.Label>
              <TextField.Input
                ref={nameInput}
                class="w-full"
                placeholder={t('teamAgents.namePlaceholder')}
                required
              />
              <Show when={tooLong()}>
                <TextField.ErrorMessage>
                  {t('teamAgents.tooLong', { count: MAX_AGENT_NAME_CHARS })}
                </TextField.ErrorMessage>
              </Show>
            </div>
          </div>
        </TextField>
      }
      computer={
        <div class="flex flex-col gap-2">
          <div class="text-sm font-medium text-ink">
            {t('teamAgents.giveItAComputer')}
          </div>
          <Show
            when={offers()}
            fallback={
              <Show
                when={props.offersFailed && !(props.hosts && nothingLoaded())}
                fallback={<ComputerSizeSkeleton />}
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
              <>
                <Show when={props.hosts}>
                  <ChoiceGroupLabel>
                    {t('teamAgents.buyAComputer')}
                  </ChoiceGroupLabel>
                </Show>
                <ComputerSizePicker
                  name={AGENT_COMPUTER_CHOICE}
                  offers={available()}
                  selected={host() ? undefined : size()}
                  onSelect={edit(chooseSize)}
                />
              </>
            )}
          </Show>
          <Show when={props.hosts && nothingLoaded()}>
            <div
              role="alert"
              class="flex flex-wrap items-center gap-2 text-sm text-ink-muted"
            >
              <span>{t('teammateHosts.computersFailed')}</span>
              <Button
                type="button"
                variant="secondary"
                size="sm"
                onClick={() => {
                  props.onRetryOffers();
                  props.onRetryHosts?.();
                }}
              >
                {t('teamAgents.tryAgain')}
              </Button>
            </div>
          </Show>
          <Show when={!nothingLoaded() && props.hosts}>
            {(hosts) => (
              <>
                <ChoiceGroupLabel>
                  {t('teamAgents.yourComputers')}
                </ChoiceGroupLabel>
                {hosts()({
                  selected: () => host()?.harnessId,
                  onSelect: edit(chooseHost),
                })}
              </>
            )}
          </Show>
          <Show when={props.options}>
            <fieldset disabled={adding()} class="contents">
              <div class="flex flex-col gap-2 pt-2">{props.options}</div>
            </fieldset>
          </Show>
        </div>
      }
      notice={
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
            <Match when={props.state.kind === 'host_failed' && host()}>
              {(picked) => (
                <FailureNotice
                  below={<TeammateCommand command="macrod teammate logs" />}
                >
                  {t('teammateHosts.hostFailed', {
                    name: trimmedName(),
                    host: picked().name,
                  })}
                </FailureNotice>
              )}
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
              {(reason) => (
                <FailureNotice>{refusalText(reason())}</FailureNotice>
              )}
            </Match>
          </Switch>
          {/* What running on the inviter's computer means, while one is picked. */}
          <Show when={props.hostNotice && host()}>
            {(picked) => props.hostNotice?.(picked(), trimmedName())}
          </Show>
        </div>
      }
      cancel={
        <Button
          type="button"
          variant="ghost"
          disabled={adding()}
          onClick={() => props.onCancel()}
        >
          {t('common.cancel')}
        </Button>
      }
      submit={
        <Button
          type="button"
          variant="primary"
          // Always pressable: with no name it marks the field instead. While
          // adding it keeps focus, so a phone sheet's focus trap doesn't move
          // it to the name field when a refusal arrives; `submit` ignores
          // presses meanwhile.
          disabled={nothingLoaded()}
          aria-disabled={adding() || undefined}
          aria-busy={adding() || undefined}
          data-disabled={adding() ? '' : undefined}
          onClick={submit}
          // A long name shortens the label instead of pushing it off a phone.
          class="min-w-0 max-w-full"
        >
          <Show
            when={adding()}
            fallback={<span class="truncate">{submitLabel()}</span>}
          >
            <SpinnerIcon class="size-4 shrink-0 animate-spin" />
            <span class="truncate">
              {t('teamAgents.adding', { name: trimmedName() })}
            </span>
          </Show>
        </Button>
      }
    />
  );
}
