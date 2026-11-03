import { createMemo, createSignal } from 'solid-js';
import type { FocusAction } from '../core/focus-actions';

export function createFocusActions(initial: FocusAction[]) {
  const [dismissed, setDismissed] = createSignal<string[]>([]);
  const [selectedId, setSelectedId] = createSignal(initial[0]?.id);
  const [openedId, setOpenedId] = createSignal<string>();
  const [drafts, setDrafts] = createSignal<Record<string, string>>({});
  const [notice, setNotice] = createSignal('');
  const actions = createMemo(() =>
    initial.filter((action) => !dismissed().includes(action.id))
  );
  const opened = () => initial.find((action) => action.id === openedId());
  const draft = (action: FocusAction) =>
    drafts()[action.id] ?? action.draft ?? '';

  function move(direction: number) {
    const list = actions();
    if (!list.length) return;
    const index = list.findIndex((action) => action.id === selectedId());
    const next = Math.max(0, Math.min(list.length - 1, index + direction));
    setSelectedId(list[next].id);
    return list[next].id;
  }

  function dismiss(id: string, message = 'Set aside for now') {
    const list = actions();
    const index = list.findIndex((action) => action.id === id);
    if (index < 0) return;
    setDismissed((previous) => [...previous, id]);
    setSelectedId(list[index + 1]?.id ?? list[index - 1]?.id);
    setOpenedId(undefined);
    setNotice(message);
  }

  function undo() {
    const last = dismissed().at(-1);
    if (!last) return;
    setDismissed((previous) => previous.slice(0, -1));
    setSelectedId(last);
    setNotice('Brought back to your list');
  }

  return {
    actions,
    selectedId,
    setSelectedId,
    opened,
    setOpenedId,
    draft,
    notice,
    setNotice,
    updateDraft: (id: string, value: string) =>
      setDrafts((previous) => ({ ...previous, [id]: value })),
    dismissedCount: () => dismissed().length,
    move,
    dismiss,
    undo,
  };
}
