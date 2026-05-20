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
  useContext,
} from 'solid-js';
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
}

const WIDE_BREAKPOINT = 512; // @lg container query = 32rem

export interface LayoutProps {
  entity: WithNotification<EntityData>;
  checked?: boolean;
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

interface ListLayoutContextValue {
  isWide: Accessor<boolean>;
}

const ListLayoutContext = createContext<ListLayoutContextValue>();

export function ListLayoutProvider(props: {
  ref: Accessor<HTMLElement | undefined>;
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
    <ListLayoutContext.Provider value={{ isWide }}>
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

export function InboxDivider() {
  return (
    <div class="col-span-3 ml-(--soup-inbox-left-of-content) min-w-full min-h-px max-h-px bg-edge-muted" />
  );
}
