import { t } from '@app/lib/i18n';
import { useUserId } from '@core/context/user';
import { createElementSize } from '@solid-primitives/resize-observer';
import { createMemo, createSignal, type JSX, onCleanup, Show } from 'solid-js';
import {
  CHANNEL_SECTION_MAX_HEIGHT,
  CHANNEL_SECTION_MIN_HEIGHT,
  CHANNEL_SECTION_MIN_ITEMS,
  CHANNEL_SECTION_ROW_HEIGHT,
  clampChannelSectionHeight,
} from '../../../constants';
import type { ChannelSectionKey } from '../../../types';
import { useChannelsRail } from '../ChannelsRailContext';

/** Preview resizing locally; persist the final height with the section's preferences. */
export function ResizableRailSection(props: {
  section: ChannelSectionKey;
  label: string;
  open: boolean;
  maxHeight: number;
  itemCount: number;
  dropEdge?: 'top' | 'bottom';
  header: JSX.Element;
  children: JSX.Element;
  rootRef: (element: HTMLDivElement) => void;
  scrollRef: (element: HTMLDivElement) => void;
}) {
  const rail = useChannelsRail();
  const userId = useUserId();
  const account = createMemo(() => ({ id: userId() }));
  const [viewport, setViewport] = createSignal<HTMLDivElement>();
  const [content, setContent] = createSignal<HTMLDivElement>();
  const contentSize = createElementSize(content);
  const [preview, setPreview] = createSignal<number>();

  const maximum = () =>
    Math.min(
      CHANNEL_SECTION_MAX_HEIGHT,
      props.maxHeight,
      contentSize.height && contentSize.height > 0
        ? contentSize.height
        : Math.max(1, props.itemCount) * CHANNEL_SECTION_ROW_HEIGHT
    );
  const resizable = () =>
    props.itemCount > CHANNEL_SECTION_MIN_ITEMS &&
    maximum() > CHANNEL_SECTION_MIN_HEIGHT;
  const defaultHeight = () => {
    if (props.section === 'favorites' || props.section === 'direct_messages') {
      return Math.min(maximum(), 4 * CHANNEL_SECTION_ROW_HEIGHT);
    }

    return maximum();
  };

  const clamp = (height: number) =>
    Math.min(maximum(), clampChannelSectionHeight(height));
  const height = () => {
    if (!resizable()) {
      return maximum();
    }

    return clamp(
      preview() ??
        rail.sectionPreferences(props.section).height ??
        defaultHeight()
    );
  };

  let drag:
    | {
        pointer: number;
        y: number;
        height: number;
        zoom: number;
        top: number;
        handle: HTMLButtonElement;
        account: ReturnType<typeof account>;
      }
    | undefined;

  const draggedHeight = (event: PointerEvent) => {
    const element = viewport();
    if (!drag || !element) {
      return height();
    }

    const shift = element.getBoundingClientRect().top - drag.top;
    return clamp(drag.height + (event.clientY - drag.y - shift) / drag.zoom);
  };
  const finish = (event: PointerEvent, cancelled = false) => {
    if (!drag || event.pointerId !== drag.pointer) {
      return;
    }

    const current = drag;
    const nextHeight = draggedHeight(event);
    drag = undefined;

    if (current.handle.hasPointerCapture?.(current.pointer)) {
      current.handle.releasePointerCapture(current.pointer);
    }

    if (
      !cancelled &&
      props.open &&
      resizable() &&
      current.account === account()
    ) {
      rail.setSectionPreferences(props.section, {
        height: nextHeight,
      });
    }

    setPreview(undefined);
  };

  return (
    <div
      ref={props.rootRef}
      class="group/rail-section relative min-w-0 shrink-0"
      data-resizing={preview() !== undefined ? '' : undefined}
    >
      <Show when={props.dropEdge}>
        {(edge) => (
          <div
            class="pointer-events-none absolute inset-x-0 z-10 h-0.5 rounded-full bg-accent"
            classList={{
              'top-0': edge() === 'top',
              'bottom-0': edge() === 'bottom',
            }}
          />
        )}
      </Show>
      {props.header}
      <Show when={props.open}>
        <div
          ref={(element) => {
            setViewport(element);
            props.scrollRef(element);
          }}
          class="min-h-0 overflow-y-auto"
          style={{ height: `${height()}px` }}
        >
          <div ref={setContent} data-section-content>
            {props.children}
          </div>
        </div>
        <Show when={resizable()}>
          {(_resizable) => {
            onCleanup(() => {
              drag = undefined;
              setPreview(undefined);
            });

            return (
              <button
                type="button"
                role="separator"
                aria-orientation="horizontal"
                aria-label={t('channelSections.resizeSection', {
                  name: props.label,
                })}
                aria-valuemin={CHANNEL_SECTION_MIN_HEIGHT}
                aria-valuemax={maximum()}
                aria-valuenow={Math.round(height())}
                title={t('channelSections.resizeSectionHint')}
                class="group flex h-3 w-full touch-none cursor-row-resize items-center justify-center rounded-full outline-none hover:bg-hover focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-edge-focus"
                onPointerDown={(event) => {
                  const element = viewport();
                  if (event.button !== 0 || !element || drag) {
                    return;
                  }

                  event.preventDefault();
                  event.stopPropagation();
                  drag = {
                    pointer: event.pointerId,
                    y: event.clientY,
                    height: element.offsetHeight,
                    zoom:
                      element.getBoundingClientRect().height /
                        element.offsetHeight || 1,
                    account: account(),
                    top: element.getBoundingClientRect().top,
                    handle: event.currentTarget,
                  };
                  setPreview(element.offsetHeight);
                  event.currentTarget.setPointerCapture(event.pointerId);
                }}
                onPointerMove={(event) => {
                  if (!drag || event.pointerId !== drag.pointer) {
                    return;
                  }

                  if (drag.account !== account()) {
                    finish(event, true);
                    return;
                  }

                  setPreview(draggedHeight(event));
                }}
                onPointerUp={(event) => finish(event)}
                onPointerCancel={(event) => finish(event, true)}
                onLostPointerCapture={(event) => finish(event, true)}
                onMouseDown={(event) => event.stopPropagation()}
                onClick={(event) => event.stopPropagation()}
                onDblClick={() =>
                  rail.setSectionPreferences(props.section, {
                    height: undefined,
                  })
                }
                onKeyDown={(event) => {
                  if (event.key !== 'ArrowUp' && event.key !== 'ArrowDown') {
                    return;
                  }

                  event.preventDefault();
                  event.stopPropagation();
                  event.stopImmediatePropagation();

                  const direction = event.key === 'ArrowDown' ? 1 : -1;
                  const step = event.shiftKey ? 100 : 20;

                  rail.setSectionPreferences(props.section, {
                    height: clamp(height() + direction * step),
                  });
                }}
              >
                <span class="h-0.5 w-8 rounded-full bg-edge-muted group-hover:bg-accent group-focus-visible:bg-accent" />
              </button>
            );
          }}
        </Show>
      </Show>
    </div>
  );
}
