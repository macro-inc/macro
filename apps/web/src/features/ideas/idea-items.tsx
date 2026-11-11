import { t } from '@app/lib/i18n';
import {
  EntityIcon,
  type EntityIconSelector,
} from '@core/component/EntityIcon';
import { useItemPreviewData } from '@core/component/ItemPreview';
import { isAccessiblePreviewItem } from '@queries/preview/types';
import { type ItemType, stringToItemType } from '@service-storage/client';
import { Show } from 'solid-js';
import type { IdeaItemParts } from './context/ideas-source';
import type { IdeaTarget } from './core/idea';
import { waitingFor } from './core/thread';
import { useIdeaThread } from './queries/idea-thread';

/** The app's item type for an idea's target; a saved routine is listed by its own name. */
function itemType(target: IdeaTarget): ItemType | undefined {
  if (target.entityType === 'scheduled_action') return 'routine';

  return stringToItemType(target.entityType);
}

/** The icon an item gets before it loads: what the idea said it was. */
const FALLBACK_ICONS: Partial<Record<ItemType, EntityIconSelector>> = {
  email: 'email',
  channel: 'channel',
  routine: 'routine',
  agent_session: 'agent',
  calendar_event: 'calendar',
  document: 'md',
};

/** An item's icon and name, read with the viewer's own access. */
function useItem(target: () => IdeaTarget) {
  const data = useItemPreviewData(() => {
    const type = itemType(target());
    // A channel item is its own shape; neither needs the message here.
    return type === 'channel'
      ? { id: target().entityId, type }
      : { id: target().entityId, type };
  });
  const accessible = () => {
    const item = data.item();
    return isAccessiblePreviewItem(item) ? item : undefined;
  };
  const type = () => itemType(target());

  return {
    accessible,
    name: () => (accessible() ? data.name() : undefined),
    icon: (): EntityIconSelector | undefined => {
      if (accessible()) return data.targetType();
      const known = type();
      return known ? FALLBACK_ICONS[known] : undefined;
    },
  };
}

function Source(props: { target: IdeaTarget; onOpen(): void }) {
  const item = useItem(() => props.target);

  return (
    <Show when={item.name()}>
      {(name) => (
        <button
          type="button"
          class="flex min-w-0 items-center gap-1.5 rounded-sm outline-none not-touch:hover:text-ink focus-visible:ring-2 focus-visible:ring-edge-focus"
          data-idea-source
          onClick={() => props.onOpen()}
        >
          <Show when={item.icon()} keyed>
            {(icon) => <EntityIcon targetType={icon} size="xs" />}
          </Show>
          <Show
            when={itemType(props.target) === 'email'}
            fallback={<span class="truncate">{name()}</span>}
          >
            <EmailSourceName
              threadId={props.target.entityId}
              subject={name()}
            />
          </Show>
        </button>
      )}
    </Show>
  );
}

function Draft(props: { draft: IdeaTarget }) {
  const thread = useIdeaThread(
    () => props.draft.entityId,
    () => props.draft.partId
  );

  return (
    <p class="line-clamp-2">{thread()?.draftText ?? t('ideas.draftReady')}</p>
  );
}

function Waiting(props: {
  thread: IdeaTarget;
  lead?: string;
  fallback?: string;
}) {
  const thread = useIdeaThread(() => props.thread.entityId);
  const waiting = () => {
    const since = thread()?.waitingSince;
    const length = since ? waitingFor(since, new Date()) : undefined;
    if (!length) return undefined;

    return length.unit === 'days'
      ? t('ideas.waitingDays', { count: length.count })
      : t('ideas.waitingHours', { count: length.count });
  };

  return (
    <Show when={waiting()} fallback={props.fallback}>
      {(text) => (
        <span data-idea-waiting>
          {props.lead}
          {text()}
        </span>
      )}
    </Show>
  );
}

/** An email chip's name: who wrote last, then the subject. */
function EmailSourceName(props: { threadId: string; subject: string }) {
  const thread = useIdeaThread(() => props.threadId);

  return (
    <span class="truncate">
      <Show when={thread()?.sender}>{(sender) => `${sender()} · `}</Show>
      {props.subject}
    </span>
  );
}

/** The card parts that read the app's items, for the For you page. */
export const IDEA_ITEM_PARTS: IdeaItemParts = {
  Source,
  Draft,
  Waiting,
};
