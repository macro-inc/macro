import {
  EntityIcon,
  type EntityIconSelector,
} from '@core/component/EntityIcon';
import { useItemPreviewData } from '@core/component/ItemPreview';
import { isAccessiblePreviewItem } from '@queries/preview/types';
import { type ItemType, stringToItemType } from '@service-storage/client';
import { Show, Suspense } from 'solid-js';
import type { SuggestionItemParts } from './context/suggestions-source';
import type { SuggestionTarget } from './core/suggestion';

/** The app's item type for an suggestion's target; a saved routine is listed by its own name. */
function itemType(target: SuggestionTarget): ItemType | undefined {
  if (target.entityType === 'scheduled_action') return 'routine';

  return stringToItemType(target.entityType);
}

/** The icon an item gets before it loads: what the suggestion said it was. */
const FALLBACK_ICONS: Partial<Record<ItemType, EntityIconSelector>> = {
  email: 'email',
  channel: 'channel',
  routine: 'routine',
  agent_session: 'agent',
  calendar_event: 'calendar',
  document: 'md',
};

/** An item's icon and name, read with the viewer's own access. */
function useItem(target: () => SuggestionTarget) {
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

type SourceProps = {
  target: SuggestionTarget;
  from?: string;
  onOpen(): void;
};

function SourceLink(props: SourceProps) {
  const item = useItem(() => props.target);

  return (
    <Show when={item.name()}>
      {(name) => (
        <button
          type="button"
          class="flex min-w-0 items-center gap-1.5 rounded-sm outline-none not-touch:hover:text-ink focus-visible:ring-2 focus-visible:ring-edge-focus"
          data-suggestion-source
          onClick={() => props.onOpen()}
        >
          <Show when={item.icon()} keyed>
            {(icon) => <EntityIcon targetType={icon} size="xs" />}
          </Show>
          <Show
            when={itemType(props.target) === 'email'}
            fallback={<span class="truncate">{name()}</span>}
          >
            <EmailSourceName from={props.from} subject={name()} />
          </Show>
        </button>
      )}
    </Show>
  );
}

/** An email source's name: who wrote, then the subject. */
function EmailSourceName(props: { from?: string; subject: string }) {
  return (
    <span class="truncate">
      <Show when={props.from}>{(from) => `${from()} · `}</Show>
      {props.subject}
    </span>
  );
}

/** The card parts that read the app's items, for the For you page. */
/**
 * A source link behind its own boundary: its item is read on demand, and a
 * pending read must not replace the feed around it with a fallback.
 */
function Source(props: SourceProps) {
  return (
    <Suspense>
      <SourceLink {...props} />
    </Suspense>
  );
}

export const SUGGESTION_ITEM_PARTS: SuggestionItemParts = { Source };
