import {
  EntityIcon,
  type EntityIconSelector,
} from '@core/component/EntityIcon';
import { useItemPreviewData } from '@core/component/ItemPreview';
import { isAccessiblePreviewItem } from '@queries/preview/types';
import { type ItemType, stringToItemType } from '@service-storage/client';
import { type JSX, Show, Suspense } from 'solid-js';
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
  fallback?: JSX.Element;
  onOpen?: () => void;
};

function SourceLabel(props: SourceProps) {
  const item = useItem(() => props.target);
  const text = (name: string) => (
    <span class="truncate" data-suggestion-source>
      {name}
      <Show when={props.from}>{(from) => ` · ${from()}`}</Show>
    </span>
  );

  return (
    <Show when={item.name()} fallback={props.fallback}>
      {(name) => (
        <Show
          when={props.onOpen}
          fallback={
            <>
              <Show when={item.icon()} keyed>
                {(icon) => (
                  <EntityIcon
                    targetType={icon}
                    theme="monochrome"
                    class="h-3 w-3 text-ink-placeholder"
                  />
                )}
              </Show>
              {text(name())}
            </>
          }
        >
          {(onOpen) => (
            <button
              type="button"
              class="flex min-w-0 items-center gap-1.5 rounded-sm outline-none not-touch:hover:text-ink focus-visible:ring-2 focus-visible:ring-edge-focus"
              onClick={() => onOpen()()}
            >
              <Show when={item.icon()} keyed>
                {(icon) => <EntityIcon targetType={icon} size="xs" />}
              </Show>
              {text(name())}
            </button>
          )}
        </Show>
      )}
    </Show>
  );
}

/**
 * A source's label behind its own boundary: its item is read on demand, and a
 * pending read must not replace the feed around it with a fallback.
 */
function Source(props: SourceProps) {
  return (
    <Suspense>
      <SourceLabel {...props} />
    </Suspense>
  );
}

/** The row parts that read the app's items, for the For you page. */
export const SUGGESTION_ITEM_PARTS: SuggestionItemParts = { Source };
