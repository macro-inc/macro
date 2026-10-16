import { formatDate } from '@core/util/date';
import { Show } from 'solid-js';
import type { PromptOrigin } from '../state/prompt-origin';

/**
 * A quiet line under a prompt: where it came from, when the harness delivered
 * it from elsewhere, and when it was posted - `via @mention in #eng · 2:02 PM`,
 * or just `2:02 PM`. Clicking the origin goes to that place.
 */
export function PromptFooter(props: {
  origin: PromptOrigin | undefined;
  /** RFC 3339; absent until the log confirms the prompt. */
  postedAt: string | undefined;
  onOpen?: () => void;
}) {
  const originText = (origin: PromptOrigin) => (
    <>
      {origin.lead}
      <Show when={origin.place}>
        {(place) => (
          <>
            {' '}
            <span class="text-ink-muted">{place()}</span>
          </>
        )}
      </Show>
      <Show when={origin.tail}>{(tail) => <> {tail()}</>}</Show>
    </>
  );
  const label = (origin: PromptOrigin) =>
    [origin.lead, origin.place, origin.tail].filter(Boolean).join(' ');

  return (
    <div
      class="mr-2 flex max-w-[85%] min-w-0 items-center gap-1.5 text-xs text-ink-extra-muted"
      data-testid="prompt-footer"
    >
      <Show when={props.origin}>
        {(origin) => (
          <Show
            when={props.onOpen}
            fallback={
              <span class="min-w-0 truncate px-1" title={label(origin())}>
                {originText(origin())}
              </span>
            }
          >
            {(open) => (
              <button
                type="button"
                title={label(origin())}
                onClick={() => open()()}
                class="min-w-0 truncate rounded px-1 text-left underline decoration-dotted underline-offset-2 not-touch:hover:bg-hover not-touch:hover:text-ink"
              >
                {originText(origin())}
              </button>
            )}
          </Show>
        )}
      </Show>
      <Show when={props.postedAt}>
        {(postedAt) => (
          <>
            <Show when={props.origin}>
              <span class="shrink-0" aria-hidden="true">
                ·
              </span>
            </Show>
            <time class="shrink-0 px-1" datetime={postedAt()}>
              {formatDate(postedAt(), { showTime: true })}
            </time>
          </>
        )}
      </Show>
    </div>
  );
}
