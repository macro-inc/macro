import { ComposerDropTarget } from '@app/features/calendar/components/composer/drop-target/ComposerDropTarget';
import { useCalendarComposerHost } from '@app/features/calendar/context/calendar-composer-host-context';
import type { CalendarComposerSession } from '@app/features/calendar/primitives/create-calendar-composer-session';
import { createComposerHeaderDrag } from '@app/features/calendar/primitives/create-composer-header-drag';
import {
  classifyOpenEventOutsidePress,
  handleOpenEventOutsidePress,
} from '@app/features/calendar/utils/open-event-outside-press';
import { StandaloneComposer } from '@app/features/calendar/views/composer/StandaloneComposer';
import { t } from '@app/lib/i18n';
import {
  startUiOperation,
  type UiOperation,
} from '@app/observability/ui-operation';
import { ScopedPortal } from '@core/component/ScopedPortal';
import { fireAndForget } from '@core/util/fireAndForget';
import { Popover } from '@kobalte/core/popover';
import { createEffect, createSignal, onCleanup, onMount, Show } from 'solid-js';

type ComposerSession = NonNullable<CalendarComposerSession['state']['session']>;

/** One mounted editor switches virtual anchors when pinned; it never moves between parents. */
export function CalendarComposerSurface(props: { session: ComposerSession }) {
  const host = useCalendarComposerHost();
  if (!host)
    throw new Error('CalendarComposerSurface requires CalendarComposerHost');
  const session = props.session;
  const pinned = () => host.sessions.state.pinned;
  const [measureVersion, setMeasureVersion] = createSignal(0);
  let content: HTMLDivElement | undefined;
  let measureFrame: number | undefined;
  let operation: UiOperation | undefined;
  const drag = createComposerHeaderDrag({
    // The dock's parent is the content area below the toolbar and beside the sidebar.
    boundary: () => host.dock()?.parentElement?.getBoundingClientRect(),
    surface: () => content?.getBoundingClientRect(),
    disabled: () => pinned() || host.sessions.state.transitioning,
    onPin: () => host.sessions.setPinned(session.key, true),
    onStart: () => {
      operation = startUiOperation('calendar.composer.drag');
    },
    onFinish: (outcome) => {
      operation?.span.setAttr('calendar.composer.drag_outcome', outcome);
      if (outcome === 'cancelled') operation?.cancel();
      else operation?.afterPaint();
      operation = undefined;
    },
  });
  const measure = () => {
    if (measureFrame !== undefined) return;
    measureFrame = requestAnimationFrame(() => {
      measureFrame = undefined;
      setMeasureVersion((version) => version + 1);
    });
  };
  onMount(() => {
    // Let the creation menu finish its focus handoff before focusing the editor.
    const openingFrame = requestAnimationFrame(() => {
      const target = content?.querySelector<HTMLElement>('textarea') ?? content;
      target?.focus({ preventScroll: true });
    });
    window.addEventListener('scroll', measure, true);
    window.addEventListener('resize', measure);
    onCleanup(() => {
      cancelAnimationFrame(openingFrame);
      window.removeEventListener('scroll', measure, true);
      window.removeEventListener('resize', measure);
      if (measureFrame !== undefined) cancelAnimationFrame(measureFrame);
    });
  });
  createEffect(() => {
    const observer = new ResizeObserver(measure);
    const boundary = host.boundary();
    const dock = host.dock();
    if (boundary) observer.observe(boundary);
    if (dock) observer.observe(dock);
    onCleanup(() => observer.disconnect());
  });
  const dockRect = () => {
    measureVersion();
    return host.dock()?.getBoundingClientRect();
  };
  const anchorRect = () => {
    measureVersion();
    const dock = dockRect();
    if (pinned() && dock)
      return new DOMRect(dock.left, dock.top, 0, dock.height);
    const position = drag.position();
    if (position) return new DOMRect(position.x - 8, position.y, 0, 0);
    const anchor = session.request.anchorRect?.();
    if (anchor) return anchor;
    const boundary = host.boundary()?.getBoundingClientRect();
    const left =
      (boundary?.left ?? 0) +
      Math.max(8, ((boundary?.width ?? window.innerWidth) - 384) / 2);
    return new DOMRect(left, (boundary?.top ?? 0) + 108, 0, 0);
  };
  const close = () =>
    fireAndForget(host.sessions.close(session.key), 'calendar-composer-close');

  return (
    <Popover
      open
      placement="right-start"
      gutter={pinned() ? 0 : 8}
      flip={!pinned() && !drag.state.position}
      slide={!pinned() && !drag.state.position}
      getAnchorRect={anchorRect}
    >
      <ScopedPortal scope="global">
        <Show when={drag.state.active && drag.target()}>
          {(bounds) => (
            <ComposerDropTarget
              bounds={bounds()}
              active={drag.state.overTarget}
            />
          )}
        </Show>
        <Popover.Content
          ref={content}
          class="portal-scope menu-surface z-modal flex min-h-0 flex-col overflow-hidden outline-none"
          classList={{
            'rounded-[14px]': !pinned(),
            'rounded-none border-l border-edge shadow-none': pinned(),
          }}
          style={{
            width: pinned() ? `${dockRect()?.width ?? 384}px` : '384px',
            height: pinned() ? `${dockRect()?.height ?? 0}px` : undefined,
            'max-width': 'calc(100vw - 32px)',
            'max-height': 'calc(100dvh - 32px)',
          }}
          onOpenAutoFocus={(event) => event.preventDefault()}
          onEscapeKeyDown={(event) => {
            event.preventDefault();
            close();
          }}
          onCloseAutoFocus={(event) => {
            event.preventDefault();
            const target = session.request.returnFocus;
            if (target?.isConnected) target.focus({ preventScroll: true });
            else host.boundary()?.focus({ preventScroll: true });
          }}
          onInteractOutside={(event) => {
            if (pinned()) {
              event.preventDefault();
              return;
            }
            // Focus handoffs do not discard drafts; pointer presses and Escape own dismissal.
            if (event.detail.originalEvent.type === 'focusin') {
              event.preventDefault();
              return;
            }
            if (
              classifyOpenEventOutsidePress(event.detail.originalEvent) ===
              'close-without-creating'
            )
              handleOpenEventOutsidePress(event);
            close();
          }}
        >
          <Popover.Title class="sr-only">
            {session.request.event?.title || t('calendar.newEvent')}
          </Popover.Title>
          <StandaloneComposer
            {...session.request}
            pinned={pinned()}
            onTogglePin={() => host.sessions.setPinned(session.key, !pinned())}
            onHeaderPointerDown={pinned() ? undefined : drag.start}
            onDirtyChange={(dirty) =>
              host.sessions.setDirty(session.key, dirty)
            }
            onSaved={() => host.sessions.markSaved(session.key)}
            onClose={close}
          />
        </Popover.Content>
      </ScopedPortal>
    </Popover>
  );
}
