import { t } from '@app/lib/i18n';
import { useUserId } from '@core/context/user';
import { createElementSize } from '@solid-primitives/resize-observer';
import { createMemo, createSignal, type JSX, onCleanup, Show } from 'solid-js';
import {
  CHANNEL_SECTION_DEFAULT_HEIGHT,
  CHANNEL_SECTION_MAX_HEIGHT,
  CHANNEL_SECTION_MIN_HEIGHT,
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
  header: JSX.Element;
  children: JSX.Element;
  rootRef: (element: HTMLDivElement) => void;
  scrollRef: (element: HTMLDivElement) => void;
}) {
  const rail = useChannelsRail();
  const userId = useUserId();
  const account = createMemo(() => ({ id: userId() }));
  const [viewport, setViewport] = createSignal<HTMLDivElement>();
  const size = createElementSize(viewport);
  const [preview, setPreview] = createSignal<number>();
  const maximum = () =>
    Math.max(
      CHANNEL_SECTION_MIN_HEIGHT,
      Math.min(CHANNEL_SECTION_MAX_HEIGHT, props.maxHeight)
    );
  const height = () =>
    preview() ?? rail.sectionPreferences(props.section).height;
  const clamp = (height: number) =>
    Math.min(maximum(), clampChannelSectionHeight(height));
  const heightStyle = () => {
    const current = height();
    return current === undefined ? undefined : `${clamp(current)}px`;
  };
  let drag:
    | {
        pointer: number;
        y: number;
        height: number;
        zoom: number;
        account: ReturnType<typeof account>;
      }
    | undefined;
  const finish = (event: PointerEvent, cancelled = false) => {
    if (!drag || event.pointerId !== drag.pointer) return;
    const current = drag;
    drag = undefined;
    if (!cancelled && props.open && current.account === account()) {
      rail.setSectionPreferences(props.section, {
        height: clamp(
          current.height + (event.clientY - current.y) / current.zoom
        ),
      });
    }
    setPreview(undefined);
  };

  return (
    <div ref={props.rootRef} class="min-w-0 shrink-0">
      {props.header}
      <Show when={props.open}>
        {(_open) => {
          onCleanup(() => {
            drag = undefined;
            setPreview(undefined);
          });
          return (
            <>
              <div
                ref={(element) => {
                  setViewport(element);
                  props.scrollRef(element);
                }}
                class="min-h-0 overflow-y-auto"
                style={{
                  height: heightStyle(),
                  'min-height': `${CHANNEL_SECTION_MIN_HEIGHT}px`,
                  'max-height': `${Math.min(maximum(), height() ?? CHANNEL_SECTION_DEFAULT_HEIGHT)}px`,
                }}
              >
                {props.children}
              </div>
              <button
                type="button"
                role="separator"
                aria-orientation="horizontal"
                aria-label={t('channelSections.resizeSection', {
                  name: props.label,
                })}
                aria-valuemin={CHANNEL_SECTION_MIN_HEIGHT}
                aria-valuemax={maximum()}
                aria-valuenow={Math.round(
                  size.height ?? CHANNEL_SECTION_DEFAULT_HEIGHT
                )}
                title={t('channelSections.resizeSectionHint')}
                class="group flex h-3 w-full touch-none cursor-row-resize items-center justify-center outline-none hover:bg-hover focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-edge-focus"
                onPointerDown={(event) => {
                  const element = viewport();
                  if (event.button !== 0 || !element || drag) return;
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
                  };
                  event.currentTarget.setPointerCapture(event.pointerId);
                }}
                onPointerMove={(event) => {
                  if (!drag || event.pointerId !== drag.pointer) return;
                  if (drag.account !== account()) {
                    finish(event, true);
                    return;
                  }
                  setPreview(
                    clamp(drag.height + (event.clientY - drag.y) / drag.zoom)
                  );
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
                  if (event.key !== 'ArrowUp' && event.key !== 'ArrowDown')
                    return;
                  event.preventDefault();
                  event.stopPropagation();
                  event.stopImmediatePropagation();
                  rail.setSectionPreferences(props.section, {
                    height: clamp(
                      (size.height ?? CHANNEL_SECTION_DEFAULT_HEIGHT) +
                        (event.key === 'ArrowDown' ? 1 : -1) *
                          (event.shiftKey ? 100 : 20)
                    ),
                  });
                }}
              >
                <span class="h-0.5 w-8 rounded-full bg-edge-muted group-hover:bg-accent group-focus-visible:bg-accent" />
              </button>
            </>
          );
        }}
      </Show>
    </div>
  );
}
