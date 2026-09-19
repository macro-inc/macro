import ArrowUpRightIcon from '@phosphor/arrow-up-right.svg';
import ArticleIcon from '@phosphor/article.svg';
import EnvelopeIcon from '@phosphor/envelope.svg';
import FolderIcon from '@phosphor/folder-simple.svg';
import HashIcon from '@phosphor/hash.svg';
import PhoneIcon from '@phosphor/phone.svg';
import SparkleIcon from '@phosphor/sparkle.svg';
import {
  MAX_RECOMMENDATIONS,
  type RecommendedItem,
  type RecommendedView,
} from '@queries/ai/homeRecommendations';
import { For, Match, Switch } from 'solid-js';
import { Dynamic } from 'solid-js/web';
import { match } from 'ts-pattern';

function suggestionIcon(entityType: RecommendedItem['entityType']) {
  return match(entityType)
    .with('email_thread', () => EnvelopeIcon)
    .with('channel', () => HashIcon)
    .with('document', () => ArticleIcon)
    .with('project', () => FolderIcon)
    .with('call', () => PhoneIcon)
    .otherwise(() => SparkleIcon);
}

export function HomeSuggestions(props: {
  view: RecommendedView;
  onSelect: (item: RecommendedItem) => void;
  onOpen: (item: RecommendedItem) => void;
  onRetry: () => void;
  onConnect: () => void;
}) {
  const items = () =>
    props.view.kind === 'items'
      ? props.view.items.slice(0, MAX_RECOMMENDATIONS)
      : [];
  return (
    <section
      aria-label="Suggested actions"
      class="mx-[15px] flex flex-col gap-[5px] pt-9 pb-2"
    >
      <Switch>
        <Match when={props.view.kind === 'items'}>
          <For each={items()}>
            {(item) => (
              <div class="group flex min-w-0 items-center text-sm rounded-lg opacity-65 transition-[color,background-color,opacity] hover:opacity-100 focus-within:opacity-100 hover:bg-hover focus-within:bg-hover">
                <button
                  type="button"
                  class="flex min-h-9 min-w-0 flex-1 items-center gap-2 rounded-lg py-2 px-3 text-left text-sm leading-5 text-ink-extra-muted transition-colors hover:text-ink focus-visible:outline-2 focus-visible:outline-accent"
                  onClick={() => props.onSelect(item)}
                  aria-label={`Ask AI about ${item.title}`}
                >
                  <span class="truncate">{item.reason}</span>
                  <span aria-hidden="true">—</span>
                  <Dynamic
                    component={suggestionIcon(item.entityType)}
                    class="size-4 shrink-0"
                    aria-hidden="true"
                  />
                  <span class="min-w-0 truncate text-ink-muted">
                    {item.title}
                  </span>
                </button>
                <button
                  type="button"
                  aria-label={`Open ${item.title} in a new split`}
                  class="mr-2 flex h-7 shrink-0 items-center justify-center gap-1 rounded-md px-2 text-sm leading-5 text-ink-extra-muted transition-colors hover:bg-active hover:text-ink focus-visible:outline-2 focus-visible:outline-accent"
                  onClick={() => props.onOpen(item)}
                >
                  <span>Open</span>
                  <ArrowUpRightIcon class="size-3.5" aria-hidden="true" />
                </button>
              </div>
            )}
          </For>
        </Match>
        <Match when={props.view.kind === 'loading'}>
          <For each={Array.from({ length: MAX_RECOMMENDATIONS })}>
            {() => (
              <div
                aria-hidden="true"
                class="mx-3 my-3 h-3 rounded-full bg-skeleton opacity-25 skeleton-shimmer after:opacity-40"
              />
            )}
          </For>
        </Match>
        <Match when={props.view.kind === 'error'}>
          <div class="flex flex-wrap items-center justify-between gap-3 px-4 py-3 text-sm text-ink-muted">
            <span>Suggestions are unavailable right now.</span>
            <button
              type="button"
              class="rounded-lg px-2 py-1 text-accent hover:bg-hover"
              onClick={props.onRetry}
            >
              Try again
            </button>
          </div>
        </Match>
        <Match when={props.view.kind === 'connect-inbox'}>
          <button
            type="button"
            class="rounded-2xl px-4 py-3 text-left text-sm text-ink-muted hover:bg-hover"
            onClick={props.onConnect}
          >
            Connect your inbox for suggested actions
          </button>
        </Match>
      </Switch>
    </section>
  );
}
