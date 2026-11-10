import { t } from '@app/lib/i18n';
import {
  EntityIcon,
  type EntityIconSelector,
} from '@core/component/EntityIcon';
import { useItemPreviewData } from '@core/component/ItemPreview';
import { useThreadQuery } from '@queries/email/thread';
import { isAccessiblePreviewItem } from '@queries/preview/types';
import type { ApiThread } from '@service-email/generated/schemas';
import { type ItemType, stringToItemType } from '@service-storage/client';
import type { InfiniteData } from '@tanstack/solid-query';
import { Show } from 'solid-js';
import type { IdeaItemParts } from './context/ideas-source';
import type { IdeaTarget } from './core/idea';

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
          class="flex max-w-64 min-w-0 items-center gap-1.5 rounded-full bg-button-secondary-bg px-2.5 py-1 text-[13px] text-ink-muted outline-none not-touch:hover:text-ink focus-visible:ring-2 focus-visible:ring-edge-focus"
          data-idea-source
          onClick={() => props.onOpen()}
        >
          <Show when={item.icon()} keyed>
            {(icon) => <EntityIcon targetType={icon} size="xs" />}
          </Show>
          <span class="truncate">{name()}</span>
        </button>
      )}
    </Show>
  );
}

function Result(props: { target: IdeaTarget; line: string }) {
  const item = useItem(() => props.target);

  return (
    <div class="flex min-w-0 items-center gap-3" data-idea-result>
      <Show when={item.icon()} keyed>
        {(icon) => (
          <span class="flex size-7 shrink-0 items-center justify-center rounded-lg bg-ink/5">
            <EntityIcon targetType={icon} size="sm" />
          </span>
        )}
      </Show>
      <div class="min-w-0">
        <p class="truncate font-medium text-ink">
          {item.name() ?? t('ideas.untitledItem')}
        </p>
        <p class="truncate text-[13px] leading-5 text-ink-muted">
          {props.line}
        </p>
      </div>
    </div>
  );
}

/** A draft's plain text, from its thread's loaded messages. */
function draftTextSelector(messageId: string | undefined) {
  return (data: InfiniteData<ApiThread, number>) => {
    for (const page of data.pages) {
      const draft = page.messages.find(
        (message) => message.db_id === messageId
      );
      if (draft) return draft.body_text ?? draft.snippet ?? undefined;
    }

    return undefined;
  };
}

function Draft(props: { draft: IdeaTarget }) {
  const thread = useThreadQuery(
    () => props.draft.entityId,
    () => ({ select: draftTextSelector(props.draft.partId) })
  );
  const text = () =>
    thread.isSuccess ? thread.data?.trim() || undefined : undefined;

  return <p class="line-clamp-3">{text() ?? t('ideas.draftReady')}</p>;
}

/** The card parts that read the app's items, for the For you page. */
export const IDEA_ITEM_PARTS: IdeaItemParts = { Source, Draft, Result };
