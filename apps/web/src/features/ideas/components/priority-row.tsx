import { t } from '@app/lib/i18n';
import { Badge, Item } from '@ui';
import { Show } from 'solid-js';
import type { Idea, IdeaStatus } from '../core/idea';
import { IdeaGlyph } from './idea-tile';

/** One of Home's priorities: the idea's tile, title and a one-line reason. */
export function PriorityRow(props: {
  idea: Idea;
  status: IdeaStatus;
  onOpen(): void;
}) {
  return (
    <li>
      <button
        type="button"
        class="group w-full min-w-0 rounded-xl text-left outline-none not-touch:hover:bg-hover focus-visible:bg-hover focus-visible:ring-2 focus-visible:ring-edge-focus"
        data-priority={props.idea.id}
        onClick={props.onOpen}
      >
        <Item size="sm">
          <Item.Icon aria-hidden="true">
            <IdeaGlyph idea={props.idea} status={props.status} />
          </Item.Icon>
          <Item.Content class="gap-0">
            <Item.Title class="truncate">{props.idea.title}</Item.Title>
            <Item.Description class="truncate">
              <Show when={props.status === 'running'}>
                {t('ideas.badgeRunning')}
                {' · '}
              </Show>
              <Show when={props.status === 'failed'}>
                {t('ideas.badgeFailed')}
                {' · '}
              </Show>
              {props.idea.summary}
            </Item.Description>
          </Item.Content>
          <Item.Actions
            class="opacity-0 group-hover:opacity-100 group-focus-visible:opacity-100"
            aria-hidden="true"
          >
            <Badge variant="secondary">{t('ideas.openItem')}</Badge>
          </Item.Actions>
        </Item>
      </button>
    </li>
  );
}
