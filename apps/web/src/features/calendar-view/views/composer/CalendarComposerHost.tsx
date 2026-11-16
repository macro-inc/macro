import { CalendarComposerHostContext } from '@app/features/calendar/context/calendar-composer-host-context';
import { createCalendarComposerSession } from '@app/features/calendar/primitives/create-calendar-composer-session';
import { t } from '@app/lib/i18n';
import { useBeforeLeave } from '@app/lib/split-router';
import { TraceFlow } from '@app/observability/flow';
import { confirmDialog } from '@ui';
import {
  createSignal,
  getOwner,
  onCleanup,
  onMount,
  type ParentProps,
  Show,
} from 'solid-js';
import { CalendarComposerSurface } from './CalendarComposerSurface';

/** Calendar-owned placement and dismissal; the editor survives grid and pin changes. */
export function CalendarComposerHost(props: ParentProps) {
  const owner = getOwner();
  const [boundary, setBoundary] = createSignal<HTMLElement>();
  const [dock, setDock] = createSignal<HTMLElement>();
  const sessions = createCalendarComposerSession({
    confirmDiscard: () =>
      confirmDialog(
        {
          title: t('calendar.discardTitle'),
          body: t('calendar.discardBody'),
          confirmLabel: t('calendar.discard'),
          cancelLabel: t('calendar.keepEditing'),
          tone: 'danger',
        },
        { owner }
      ),
  });
  useBeforeLeave(async ({ signal, onCommit }) => {
    const session = sessions.state.session;
    if (!session) return true;
    const approved = await session.guard.confirmClose();
    if (!approved || signal.aborted) return false;
    onCommit(() => sessions.completeClose(session.key));
    return true;
  });
  onMount(() => {
    const beforeUnload = (event: BeforeUnloadEvent) => {
      if (!sessions.hasUnsavedChanges()) return;
      event.preventDefault();
      event.returnValue = '';
    };
    window.addEventListener('beforeunload', beforeUnload);
    onCleanup(() => window.removeEventListener('beforeunload', beforeUnload));
  });

  return (
    <CalendarComposerHostContext.Provider
      value={{
        sessions,
        boundary,
        dock,
        setDock,
        open: (request) =>
          sessions.open({
            ...request,
            returnFocus:
              request.returnFocus ??
              (document.activeElement instanceof HTMLElement
                ? document.activeElement
                : undefined),
          }),
      }}
    >
      <div
        ref={setBoundary}
        data-calendar-composer-host=""
        data-calendar-composer-open={Boolean(sessions.state.session)}
        tabindex="-1"
        class="relative flex size-full min-h-0 min-w-0 flex-col outline-none"
      >
        {props.children}
      </div>
      <Show keyed when={sessions.state.session}>
        {(session) => (
          <TraceFlow name="calendar.composer">
            <CalendarComposerSurface session={session} />
          </TraceFlow>
        )}
      </Show>
    </CalendarComposerHostContext.Provider>
  );
}
