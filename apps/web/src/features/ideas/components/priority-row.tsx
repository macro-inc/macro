import { t } from '@app/lib/i18n';
import { Show } from 'solid-js';
import type { IdeaItemParts } from '../context/ideas-source';
import type { Idea, IdeaStatus } from '../core/idea';
import { IdeaTile } from './idea-tile';

/** One of Home's priorities: the idea's tile, title and a one-line reason. */
export function PriorityRow(props: {
  idea: Idea;
  status: IdeaStatus;
  parts: Pick<IdeaItemParts, 'Waiting'>;
  onOpen(): void;
}) {
  return (
    <li>
      <button
        type="button"
        class="group flex w-full min-w-0 items-center gap-3 rounded-xl px-3 py-2.5 text-left outline-none not-touch:hover:bg-hover focus-visible:bg-hover focus-visible:ring-2 focus-visible:ring-edge-focus"
        data-priority={props.idea.id}
        onClick={props.onOpen}
      >
        <IdeaTile idea={props.idea} />
        <span class="flex min-w-0 flex-1 flex-col">
          <span class="truncate text-sm font-medium text-ink">
            {props.idea.title}
          </span>
          <span class="flex min-w-0 items-center gap-1.5 text-xs text-ink-extra-muted">
            <Show when={props.status === 'running'}>
              <span class="shrink-0">{t('ideas.badgeRunning')}</span>
            </Show>
            <Show when={props.status === 'failed'}>
              <span
                class="size-1.5 shrink-0 rounded-full bg-warning"
                aria-hidden="true"
              />
              <span class="shrink-0">{t('ideas.badgeFailed')}</span>
            </Show>
            <Show
              when={
                props.status === 'open' &&
                props.idea.kind === 'entity' &&
                props.idea.draft
              }
              keyed
              fallback={<span class="truncate">{props.idea.summary}</span>}
            >
              {(draft) => (
                <span class="truncate">
                  {t('ideas.replyDrafted')}
                  <props.parts.Waiting thread={draft} lead=" · " />
                </span>
              )}
            </Show>
          </span>
        </span>
        <span
          class="shrink-0 rounded-full bg-button-secondary-bg px-2.5 py-1 text-xs font-medium text-ink opacity-0 group-hover:opacity-100 group-focus-visible:opacity-100"
          aria-hidden="true"
        >
          {t('ideas.openItem')}
        </span>
      </button>
    </li>
  );
}
