import { type Accessor, createEffect, createSignal, on } from 'solid-js';

type CreateMessageSelectionOptions = {
  keys: Accessor<string[]>;
  /**
   * If the currently selected id matches this accessor's value, the auto-clear
   * effect will leave it alone even when it isn't in `keys`. Use this to
   * protect a target the channel is actively trying to bring into view (e.g.
   * a find-bar / URL-deeplink target whose around-fetch hasn't landed yet) so
   * the selection survives the gap between "select called" and "message
   * appears in messageIndex".
   */
  protectedId?: Accessor<string | undefined>;
};

export type MessageSelection = {
  selectedId: Accessor<string | undefined>;
  select: (id: string) => void;
  clear: () => void;
  selectFirst: () => string | undefined;
  selectPrevious: () => string | undefined;
  selectNext: () => string | undefined;
};

export function createMessageSelection(
  options: CreateMessageSelectionOptions
): MessageSelection {
  const [selectedId, setSelectedId] = createSignal<string | undefined>();

  // Auto-clear if selected ID disappears from keys, *unless* it's the
  // currently-protected target — see `protectedId` doc above.
  createEffect(
    on(options.keys, (keys) => {
      const current = selectedId();
      if (!current || keys.includes(current)) return;
      if (current === options.protectedId?.()) return;
      setSelectedId(undefined);
    })
  );

  const select = (id: string) => setSelectedId(id);
  const clear = () => setSelectedId(undefined);

  const selectFirst = (): string | undefined => {
    const keys = options.keys();
    if (keys.length === 0) return undefined;
    const first = keys[0];
    setSelectedId(first);
    return first;
  };

  const selectPrevious = (): string | undefined => {
    const keys = options.keys();
    if (keys.length === 0) return undefined;

    const current = selectedId();
    if (!current) {
      const last = keys[keys.length - 1];
      setSelectedId(last);
      return last;
    }

    const idx = keys.indexOf(current);
    if (idx <= 0) return current;

    const prev = keys[idx - 1];
    setSelectedId(prev);
    return prev;
  };

  const selectNext = (): string | undefined => {
    const keys = options.keys();
    const current = selectedId();
    if (!current) return undefined;

    const idx = keys.indexOf(current);
    if (idx === -1 || idx >= keys.length - 1) {
      setSelectedId(undefined);
      return undefined;
    }

    const next = keys[idx + 1];
    setSelectedId(next);
    return next;
  };

  return { selectedId, select, clear, selectFirst, selectPrevious, selectNext };
}
