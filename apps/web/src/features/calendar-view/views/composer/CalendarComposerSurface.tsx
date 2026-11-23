import { ComposerDropTarget } from '@app/features/calendar/components/composer/drop-target/ComposerDropTarget';
import { useCalendarComposerHost } from '@app/features/calendar/context/calendar-composer-host-context';
import type { CalendarComposerSession } from '@app/features/calendar/primitives/create-calendar-composer-session';
import { createCalendarPanelPlacement } from '@app/features/calendar/primitives/create-calendar-panel-placement';
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
import { onCleanup, onMount, Show } from 'solid-js';

type ComposerSession = NonNullable<CalendarComposerSession['state']['session']>;

/** One mounted editor switches virtual anchors when pinned; it never moves between parents. */
export function CalendarComposerSurface(props: { session: ComposerSession }) {
  const host = useCalendarComposerHost();
  if (!host)
    throw new Error('CalendarComposerSurface requires CalendarComposerHost');
  const session = props.session;
  const pinned = host.composerPinned;
  let content: HTMLDivElement | undefined;
  let operation: UiOperation | undefined;
  const { drag, docked, dockRect, anchorRect, maxHeight } =
    createCalendarPanelPlacement({
      boundary: host.boundary,
      dock: host.dock,
      surface: () => content,
      anchor: () => session.request.anchorRect?.(),
      disabled: () => host.sessions.state.transitioning,
      pinned,
      canPin: host.canPinComposer,
      onPin: () => {
        if (host.canPinComposer()) host.sessions.setPinned(session.key, true);
      },
      onUnpin: () => host.sessions.setPinned(session.key, false),
      onStart: () => {
        operation = startUiOperation('calendar.composer.drag');
        host.setDrag(drag);
      },
      onFinish: (outcome) => {
        host.setDrag(undefined);
        operation?.span.setAttr('calendar.composer.drag_outcome', outcome);
        if (outcome === 'cancelled') operation?.cancel();
        else operation?.afterPaint();
        operation = undefined;
      },
    });
  onMount(() => {
    // Let the creation menu finish its focus handoff before focusing the editor.
    const openingFrame = requestAnimationFrame(() => {
      const target = content?.querySelector<HTMLElement>('textarea') ?? content;
      target?.focus({ preventScroll: true });
    });
    onCleanup(() => cancelAnimationFrame(openingFrame));
  });
  const close = () =>
    fireAndForget(host.sessions.close(session.key), 'calendar-composer-close');

  return (
    <Popover
      open
      placement="right-start"
      gutter={docked() ? 0 : 8}
      flip={!docked() && !drag.state.position}
      slide={!docked() && !drag.state.position}
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
        {/* Local menus must escape the card; the editor body owns scrolling. */}
        <Popover.Content
          data-calendar-composer-surface
          ref={content}
          class="portal-scope menu-surface z-modal flex min-h-0 flex-col overflow-visible outline-none"
          classList={{
            'rounded-3xl shadow-lg': !docked(),
            'rounded-none border-r border-edge shadow-none': docked(),
          }}
          style={{
            width: docked() ? `${dockRect()?.width ?? 384}px` : '476px',
            height: docked() ? `${dockRect()?.height ?? 0}px` : undefined,
            'max-width': 'calc(100vw - 32px)',
            'max-height': `${maxHeight()}px`,
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
            onTogglePin={
              host.canPinComposer()
                ? () => {
                    drag.reset();
                    host.sessions.setPinned(session.key, !pinned());
                  }
                : undefined
            }
            onHeaderPointerDown={drag.start}
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
