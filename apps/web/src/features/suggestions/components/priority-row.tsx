import { t } from '@app/lib/i18n';
import { Show } from 'solid-js';
import type { Suggestion } from '../core/suggestion';
import { SuggestionTile } from './suggestion-tile';
import { waitingLabel } from './waiting';

/** One of Home's priorities: the suggestion's tile, title and a one-line reason. */
export function PriorityRow(props: { suggestion: Suggestion; onOpen(): void }) {
  return (
    <li>
      <button
        type="button"
        class="group flex w-full min-w-0 items-center gap-3 rounded-xl px-3 py-2.5 text-left outline-none not-touch:hover:bg-hover focus-visible:bg-hover focus-visible:ring-2 focus-visible:ring-edge-focus"
        data-priority={props.suggestion.id}
        onClick={props.onOpen}
      >
        <SuggestionTile suggestion={props.suggestion} />
        <span class="flex min-w-0 flex-1 flex-col">
          <span class="truncate text-sm font-medium text-ink">
            {props.suggestion.title}
          </span>
          <span class="flex min-w-0 items-center gap-1.5 text-xs text-ink-extra-muted">
            <Show when={props.suggestion.status === 'running'}>
              <span class="shrink-0">{t('suggestions.badgeRunning')}</span>
            </Show>
            <Show when={props.suggestion.status === 'failed'}>
              <span
                class="size-1.5 shrink-0 rounded-full bg-warning"
                aria-hidden="true"
              />
              <span class="shrink-0">{t('suggestions.badgeFailed')}</span>
            </Show>
            <Show
              when={
                props.suggestion.status === 'open' &&
                props.suggestion.kind === 'entity' &&
                props.suggestion.draft
              }
              fallback={
                <span class="truncate">{props.suggestion.summary}</span>
              }
            >
              <span class="truncate">
                {t('suggestions.replyDrafted')}
                <Show when={waitingLabel(props.suggestion)}>
                  {(waiting) => ` · ${waiting()}`}
                </Show>
              </span>
            </Show>
          </span>
        </span>
        <span
          class="shrink-0 rounded-full bg-button-secondary-bg px-2.5 py-1 text-xs font-medium text-ink opacity-0 group-hover:opacity-100 group-focus-visible:opacity-100"
          aria-hidden="true"
        >
          {t('suggestions.openItem')}
        </span>
      </button>
    </li>
  );
}
