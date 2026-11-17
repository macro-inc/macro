import { fireAndForget } from '@core/util/fireAndForget';
import { type Accessor, createEffect, on } from 'solid-js';
import type { ComposerOpenRequest } from '../core/composer-session';
import type { CalendarEvent } from '../types';
import { canEditCalendarEvent } from '../utils/event-interaction';

/** Selected occurrences drive one imperative replacement; cache refreshes never reset a draft. */
export function createPinnedComposerSelection(options: {
  event: Accessor<CalendarEvent | undefined>;
  anchor: Accessor<HTMLElement | undefined>;
  pinnedSession: Accessor<{ key: number } | undefined>;
  enabled: Accessor<boolean>;
  open: (request: ComposerOpenRequest) => Promise<number | undefined>;
  replacePinned: (
    key: number,
    resolveLatest: () => ComposerOpenRequest | undefined
  ) => Promise<number | undefined>;
}) {
  const resolveLatest = (): ComposerOpenRequest | undefined => {
    const event = options.event();
    if (!event || !options.enabled() || !canEditCalendarEvent(event)) return;
    const anchor = options.anchor();
    return {
      event,
      returnFocus: anchor,
      anchorRect: () =>
        anchor?.isConnected ? anchor.getBoundingClientRect() : undefined,
    };
  };

  const open = (request: ComposerOpenRequest): Promise<number | undefined> => {
    if (request.event && !canEditCalendarEvent(request.event))
      return Promise.resolve(undefined);
    const session = options.pinnedSession();
    if (!options.enabled() || !session || !request.event)
      return options.open(request);
    const selectedAtOpen = options.event()?.id;
    return options.replacePinned(session.key, () => {
      const currentId = options.event()?.id;
      // An explicit request without its own selection remains valid until selection changes.
      if (currentId === selectedAtOpen && currentId !== request.event?.id)
        return request;
      const latest = resolveLatest();
      return latest ? { ...request, ...latest } : undefined;
    });
  };

  // This effect dispatches a dialog/session command, not a copy of selection state.
  // Only a new occurrence triggers it; the resolver rechecks the latest selection after consent.
  createEffect(
    on(
      () => options.event()?.id,
      (id, previousId) => {
        if (id === previousId || !options.enabled()) return;
        const session = options.pinnedSession();
        if (!session || !resolveLatest()) return;
        fireAndForget(
          options.replacePinned(session.key, resolveLatest),
          'calendar-pinned-composer-selection'
        );
      }
    )
  );
  return { open };
}
