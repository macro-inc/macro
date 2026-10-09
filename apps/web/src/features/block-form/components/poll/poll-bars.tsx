import Circle from '@phosphor/circle.svg';
import CheckCircle from '@phosphor-fill/check-circle-fill.svg';
import { Key } from '@solid-primitives/keyed';
import { cn } from '@ui';
import { For, Show } from 'solid-js';
import type { PollBar } from '../../core/tally';

/**
 * One tab stop for the options: the voted one, else the first. Arrows move
 * between them; Space or Enter votes, so moving never casts a vote.
 */
function moveFocus(event: KeyboardEvent, list: HTMLElement | null) {
  const step =
    event.key === 'ArrowDown' || event.key === 'ArrowRight'
      ? 1
      : event.key === 'ArrowUp' || event.key === 'ArrowLeft'
        ? -1
        : 0;
  if (!step || !list || !(event.currentTarget instanceof HTMLElement)) return;
  event.preventDefault();
  const options = [...list.querySelectorAll<HTMLElement>('[data-poll-option]')];
  const at = options.indexOf(event.currentTarget);
  options[(at + step + options.length) % options.length]?.focus();
}

/**
 * A poll's options as bars: each is the vote button for that option, with
 * its count when results show. The viewer's own vote is marked.
 */
export function PollBars(props: {
  question: string;
  /** The surrounding document card already displays the question. */
  showQuestion?: boolean;
  bars: readonly PollBar[];
  showResults: boolean;
  multi: boolean;
  disabled: boolean;
  /** Keep keyboard focus while saving, and reject repeated votes. */
  pending?: boolean;
  summary: string;
  /** What shows instead of the summary while counts aren't shown. */
  hiddenNote: string;
  onVote: (optionId: string) => void;
  /** The results door: `expanded` when it shows them in place. */
  results?: {
    label: string;
    expanded: boolean | undefined;
    onOpen: () => void;
  };
}) {
  let list: HTMLUListElement | undefined;
  const stop = () => {
    const mine = props.bars.findIndex((bar) => bar.mine);
    return mine >= 0 ? mine : 0;
  };
  return (
    <div class="flex flex-col gap-3" data-form-poll>
      <Show when={props.showQuestion !== false}>
        <p class="line-clamp-2 h-10 text-sm leading-5 font-medium text-ink wrap-anywhere">
          {props.question}
        </p>
      </Show>
      <ul
        ref={list}
        class="flex flex-col gap-2"
        role={props.multi ? 'group' : 'radiogroup'}
        aria-label={props.question}
      >
        <Key each={props.bars} by="optionId">
          {(bar, index) => (
            <li role="none">
              <button
                type="button"
                title={bar().label}
                data-poll-option
                data-keyboard-input
                role={props.multi ? 'checkbox' : 'radio'}
                aria-checked={bar().mine}
                tabIndex={stop() === index() ? 0 : -1}
                disabled={props.disabled}
                aria-disabled={props.disabled || props.pending}
                onKeyDown={(event) => moveFocus(event, list ?? null)}
                class={cn(
                  'relative flex h-11 w-full items-center gap-2 overflow-hidden rounded-lg border px-3 text-left text-sm outline-none focus-visible:ring-2 focus-visible:ring-edge-focus disabled:opacity-70 aria-disabled:opacity-70',
                  bar().mine
                    ? 'border-accent bg-accent-bg'
                    : 'border-edge-muted bg-page hover:bg-hover'
                )}
                onClick={() => {
                  if (!props.disabled && !props.pending)
                    props.onVote(bar().optionId);
                }}
              >
                <Show when={props.showResults}>
                  <span
                    aria-hidden="true"
                    class={cn(
                      'absolute inset-y-0 left-0 transition-[width] duration-300 motion-reduce:transition-none',
                      bar().mine ? 'bg-accent-bg' : 'bg-active'
                    )}
                    style={{ width: `${bar().percent}%` }}
                  />
                </Show>
                <span class="relative flex min-w-0 flex-1 items-center gap-1.5 text-ink">
                  <Show
                    when={bar().mine}
                    fallback={
                      <Circle
                        class="size-4 shrink-0 text-ink-subtle"
                        aria-hidden="true"
                      />
                    }
                  >
                    <CheckCircle
                      class="size-4 shrink-0 text-accent"
                      aria-hidden="true"
                    />
                  </Show>
                  <span class="truncate">{bar().label}</span>
                </span>
                <Show when={props.showResults}>
                  <span class="relative flex shrink-0 items-center gap-2 text-xs text-ink-muted tabular-nums">
                    {bar().count}
                    <span class="sr-only">
                      {bar().count === 1 ? ' vote' : ' votes'}
                    </span>
                    <span aria-hidden="true" class="w-8 text-right font-medium">
                      {bar().percent}%
                    </span>
                  </span>
                </Show>
              </button>
            </li>
          )}
        </Key>
      </ul>
      <div class="flex h-10 items-center gap-3 border-t border-edge-divider pt-2 text-xs leading-4 text-ink-muted">
        <Show
          when={props.showResults}
          fallback={<span class="line-clamp-2">{props.hiddenNote}</span>}
        >
          <span class="line-clamp-2">{props.summary}</span>
        </Show>
        <Show when={props.results}>
          {(results) => (
            <button
              type="button"
              aria-expanded={results().expanded}
              class="ml-auto shrink-0 rounded text-link outline-none hover:underline focus-visible:ring-2 focus-visible:ring-edge-focus"
              onClick={results().onOpen}
            >
              {results().label}
            </button>
          )}
        </Show>
      </div>
    </div>
  );
}

/** The tally spelled out, for respondents who cannot open the responses. */
export function PollResults(props: {
  bars: readonly PollBar[];
  summary: string;
}) {
  return (
    <section
      aria-label="Poll results"
      class="rounded-lg border border-edge-muted bg-panel px-3 py-2"
    >
      <table class="w-full text-xs">
        <caption class="sr-only">Votes per option</caption>
        <tbody>
          <For each={props.bars}>
            {(bar) => (
              <tr>
                <th scope="row" class="py-0.5 text-left font-normal text-ink">
                  {bar.label}
                  <Show when={bar.mine}>
                    <span class="ml-1 text-ink-muted">(your vote)</span>
                  </Show>
                </th>
                <td class="py-0.5 text-right text-ink-muted tabular-nums">
                  {bar.count === 1 ? '1 vote' : `${bar.count} votes`} ·{' '}
                  {bar.percent}%
                </td>
              </tr>
            )}
          </For>
        </tbody>
      </table>
      <p class="mt-1 text-[11px] text-ink-muted">{props.summary}</p>
    </section>
  );
}
