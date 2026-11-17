import { fireAndForget } from '@core/util/fireAndForget';
import ArrowSquareOut from '@icon/system/regular/arrow-square-out.svg';
import { Button } from '@ui';
import { createSignal, Show } from 'solid-js';
import { PollBars, PollResults } from '../components/poll/poll-bars';
import { useFormContext } from '../context/form-context';
import type { FormDetail } from '../core/form-model';
import { availabilityLine, formAvailability } from '../core/form-status';
import { type Poll, pollOf } from '../core/tally';
import { createPollVoting } from '../primitives/create-poll-voting';
import { RespondView } from './respond-view';

/**
 * A poll's card body: vote and see the tally. When the tally names voters
 * (editors, or respondents of a poll that shares its responses, never an
 * anonymous one), Results shows who chose each option; otherwise those who
 * may read the responses get "Responses", the Responses tab.
 */
function PollCardBody(props: {
  detail: FormDetail;
  poll: Poll;
  onOpenResponses: () => void;
}) {
  const context = useFormContext();
  const isEditor = () => props.detail.access !== 'view';
  const canReadResponses = () =>
    isEditor() || props.detail.form.responsesVisible;
  const [showingResults, setShowingResults] = createSignal(false);
  const availability = () =>
    formAvailability(props.detail.form, props.detail.tableGone, new Date());
  const open = () => availability().kind === 'open';
  const mine = context.responses.createMine(() => props.detail.form.id);
  const tally = context.responses.createTally(() => props.detail.form.id);
  const voting = createPollVoting({
    poll: () => props.poll,
    anonymous: () => props.detail.form.anonymous,
    mine: mine.response,
    tally: tally.value,
    submit: (answers) =>
      context.responses.submit(props.detail.form.id, answers),
    editMine: (answers) =>
      context.responses.editMine(props.detail.form.id, answers),
    notify: context.notify.failure,
  });
  return (
    <div class="flex flex-col gap-2">
      <PollBars
        question={props.detail.form.name}
        showQuestion={false}
        bars={voting.bars()}
        showResults={voting.hasTally()}
        multi={props.poll.multi}
        disabled={!context.viewer.userId() || !open() || voting.final()}
        pending={voting.pending()}
        summary={voting.summary()}
        hiddenNote={
          tally.failure() ? 'Results couldn’t be loaded.' : 'Loading results…'
        }
        onVote={(optionId) =>
          fireAndForget(voting.vote(optionId), 'poll-voting')
        }
        results={
          voting.hasVoters()
            ? {
                label: showingResults() ? 'Hide results' : 'Results',
                expanded: showingResults(),
                onOpen: () => setShowingResults(!showingResults()),
              }
            : canReadResponses()
              ? {
                  label: 'Responses',
                  expanded: undefined,
                  onOpen: props.onOpenResponses,
                }
              : undefined
        }
      />
      <Show when={props.detail.form.anonymous}>
        <p class="text-xs text-ink-muted">
          {voting.final()
            ? 'You voted. Anonymous poll: votes aren’t linked to people, so yours can’t be changed.'
            : 'Anonymous poll: votes aren’t linked to people, not even for the poll’s owner.'}
        </p>
      </Show>
      <Show when={!open()}>
        <p class="text-xs text-ink-muted">
          {availabilityLine(availability(), new Date())}
        </p>
      </Show>
      <Show when={voting.hasVoters() && showingResults()}>
        <PollResults
          ref={(element) =>
            // A card in a message is a fixed-height embed: bring the opened
            // results into view instead of leaving them below its fold.
            requestAnimationFrame(() =>
              element.scrollIntoView?.({ block: 'nearest' })
            )
          }
          bars={voting.bars()}
          viewerId={context.viewer.userId()}
          renderPerson={context.ui.renderPerson}
          onOpenResponses={
            canReadResponses() ? props.onOpenResponses : undefined
          }
        />
      </Show>
    </div>
  );
}

/**
 * A form inside a message or document (RFC 03 §1, §3): a poll renders as
 * bars; any other form fills in place, compact. Answers stay in memory per
 * viewer and never go into the message. On a phone the card offers Open.
 * The card around this body (`DocumentCard`) shows the form's icon and
 * name, and its menu's Convert to Inline Mention minimizes it.
 */
export function FormCardView(props: {
  detail: FormDetail;
  narrow: boolean;
  onOpen: () => void;
  onOpenResponses: () => void;
  refetch: () => Promise<boolean>;
}) {
  const poll = () => pollOf(props.detail);
  return (
    <div class="flex flex-col gap-3 p-3" data-form-card={props.detail.form.id}>
      <div class="flex items-center gap-2 text-xs">
        <Show when={!poll()}>
          <span class="rounded-full border border-edge-muted px-2 py-0.5 text-ink-muted">
            {props.detail.access === 'view' ? 'can respond' : 'can edit'}
          </span>
        </Show>
        <Show when={poll()}>
          <span class="text-ink-muted">Poll</span>
        </Show>
        <Button
          variant="ghost"
          size="xs"
          class="ml-auto"
          onClick={props.onOpen}
        >
          <ArrowSquareOut class="size-3" />
          Open
        </Button>
      </div>
      <Show
        when={poll() || !props.narrow}
        fallback={
          <Button variant="secondary" size="sm" onClick={props.onOpen}>
            Open the form to respond
          </Button>
        }
      >
        <Show
          when={poll()}
          fallback={
            <RespondView
              detail={props.detail}
              compact
              refetch={props.refetch}
            />
          }
        >
          {(found) => (
            <PollCardBody
              detail={props.detail}
              poll={found()}
              onOpenResponses={props.onOpenResponses}
            />
          )}
        </Show>
      </Show>
    </div>
  );
}
