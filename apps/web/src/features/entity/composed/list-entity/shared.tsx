import type { DateValue } from '@core/util/date';
import type { StreamEvent } from '@service-connection/generated/schemas';
import { createElementSize } from '@solid-primitives/resize-observer';
import {
  type Accessor,
  createContext,
  createEffect,
  createSignal,
  type JSX,
  onCleanup,
  type Ref,
  Show,
  useContext,
} from 'solid-js';
import { MultiSelectCheckbox } from '../../components/MultiSelectCheckbox';
import { UnreadIndicator } from '../../components/UnreadIndicator';
import type { EntityRowConfig } from '../../extractors-notification';
import type { EntityData, ProjectEntity } from '../../types/entity';
import type { WithNotification } from '../../types/notification';
import type { ContentHitData, SearchLocation } from '../../types/search';
import { isSearchEntity } from '../../types/search';

export interface BaseListEntityProps<E extends EntityData = EntityData> {
  entity: WithNotification<E>;
  onClick?: (event: MouseEvent) => void;
  timestamp?: DateValue | null;
  ref?: Ref<HTMLDivElement>;
  checked?: boolean;
  highlighted?: boolean;
  hovered?: boolean;
  hideContentHits?: boolean;
  /** Hide the multi-select checkbox (e.g. read-only embeds outside soup). */
  hideCheckbox?: boolean;
  onChecked?: (checked: boolean, shiftKey: boolean) => void;
  onMouseMove?: () => void;
  onProjectClick?: (
    entity: ProjectEntity,
    e: PointerEvent | MouseEvent
  ) => void;
  onContentHitClick?: (
    e: PointerEvent | MouseEvent,
    location?: SearchLocation
  ) => void;
  entityRowConfig?: EntityRowConfig;
  /** The row visually closes its group (or the list) — the next row is a
   * group header or absent. Layouts use it to drop a trailing divider. */
  isLastInGroup?: boolean;
}

const WIDE_BREAKPOINT = 512; // @lg container query = 32rem

export interface LayoutProps {
  entity: WithNotification<EntityData>;
  checked?: boolean;
  hideCheckbox?: boolean;
  onChecked?: (checked: boolean, shiftKey: boolean) => void;
  unread: boolean;
  isShared: boolean;
  hasNotifications: boolean;
  showHitSnippet: boolean;
  streamState?: StreamEvent;
  setSnippetContainerRef: (el: HTMLElement) => void;
  chars: number;
  onProjectClick?: (
    entity: ProjectEntity,
    e: PointerEvent | MouseEvent
  ) => void;
}

export type NarrowLayoutVariant = 'standard' | 'condensed' | 'single-line';

interface ListLayoutContextValue {
  isWide: Accessor<boolean>;
  narrowLayout: Accessor<NarrowLayoutVariant>;
}

const ListLayoutContext = createContext<ListLayoutContextValue>();

export function ListLayoutProvider(props: {
  ref: Accessor<HTMLElement | undefined>;
  narrowLayout?: NarrowLayoutVariant;
  children: JSX.Element;
}) {
  const [isWide, setIsWide] = createSignal(true);

  createEffect(() => {
    const el = props.ref();
    if (!el) return;
    const observer = new ResizeObserver((entries) => {
      setIsWide((entries[0]?.contentRect.width ?? 0) >= WIDE_BREAKPOINT);
    });
    observer.observe(el);
    onCleanup(() => observer.disconnect());
  });

  return (
    <ListLayoutContext.Provider
      value={{ isWide, narrowLayout: () => props.narrowLayout ?? 'standard' }}
    >
      {props.children}
    </ListLayoutContext.Provider>
  );
}

export const useListLayout = () => useContext(ListLayoutContext);

export const hasSearchContentHits = (entity: EntityData) =>
  isSearchEntity(entity) && !!entity.search.contentHitData?.length;

export function firstContentHit(
  entity: EntityData
): ContentHitData | undefined {
  return isSearchEntity(entity) ? entity.search.contentHitData?.[0] : undefined;
}

/**
 * Tracks the half-width character budget of an element via ResizeObserver.
 * Used as the chars argument to windowSearchMatch so the snippet windowing
 * tracks the actual rendered width.
 */
export function useCharacterCount(ref: Accessor<HTMLElement | undefined>) {
  const size = createElementSize(ref);
  const [chars, setChars] = createSignal(200);
  const CHAR_WIDTH_PX = 6; // approximation for text-sm

  createEffect(() => {
    if (!size.width) return;
    setChars(Math.round(size.width / CHAR_WIDTH_PX / 2));
  });

  return chars;
}

/**
 * The single-line rows' indicator cell: the multi-select checkbox while the
 * row is checked, otherwise the unread dot in an always-reserved slot so
 * toggling selection doesn't shift the row.
 */
export function RowIndicator(props: {
  checked?: boolean;
  hideCheckbox?: boolean;
  onChecked?: (checked: boolean, shiftKey: boolean) => void;
  unread: boolean;
}) {
  return (
    <Show
      when={!props.hideCheckbox && props.checked}
      fallback={
        <div class="size-4 p-0.5 flex items-center justify-center">
          <UnreadIndicator active={props.unread} />
        </div>
      }
    >
      <div class="w-4 overflow-hidden">
        <MultiSelectCheckbox
          checked={props.checked}
          onChecked={props.onChecked}
        />
      </div>
    </Show>
  );
}

export function InboxDivider() {
  return (
    <div class="col-span-3 ml-(--soup-inbox-left-of-content) min-w-full min-h-px max-h-px bg-edge-muted" />
  );
}
