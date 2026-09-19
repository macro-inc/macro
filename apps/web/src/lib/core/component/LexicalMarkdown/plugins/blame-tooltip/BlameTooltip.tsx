import { UserIcon } from '@core/component/UserIcon';
import { getDisplayNameParts, macroIdToEmail, tryMacroId } from '@core/user';
import { formatRelativeTimestamp } from '@entity';
import { useNodeBlameQuery } from '@queries/blame';
import { createScheduled, debounce } from '@solid-primitives/scheduled';
import {
  createEffect,
  createMemo,
  createSignal,
  onCleanup,
  Show,
  untrack,
} from 'solid-js';
import type { Store } from 'solid-js/store';
import type { BlameTooltipState } from './blameTooltipPlugin';

const FETCH_DELAY_MS = 400;
const SHOW_DELAY_MS = 500;

function UserLine(props: { userId: string; editedAt: Date }) {
  const macroId = tryMacroId(props.userId);
  const name = () =>
    getDisplayNameParts(macroId).firstName ||
    (macroId ? macroIdToEmail(macroId) : props.userId);

  return (
    <span class="inline-flex items-center gap-1">
      <UserIcon id={props.userId} size="sm" suppressClick showTooltip={false} />
      {name()}, {formatRelativeTimestamp(props.editedAt)}
    </span>
  );
}

export function BlameTooltip(props: {
  state: Store<BlameTooltipState>;
  documentId: string;
}) {
  const [visible, setVisible] = createSignal(false);
  let shownAtX = 0;
  let shownAtY = 0;
  let showTimer: ReturnType<typeof setTimeout> | null = null;

  // Only commits to a new nodeId after FETCH_DELAY_MS of hover stillness.
  const scheduled = createScheduled((fn) => debounce(fn, FETCH_DELAY_MS));
  const queriedNodeId = createMemo<string | null>((prev) => {
    const active = props.state.hovering ? props.state.nodeId : null;
    return scheduled() ? active : prev;
  }, null);

  const hide = () => {
    if (showTimer) clearTimeout(showTimer);
    showTimer = null;
    setVisible(false);
  };

  const query = useNodeBlameQuery(props.documentId, queriedNodeId);

  // Drive visibility based on cursor stillness (x/y).
  createEffect(() => {
    const { hovering, x, y } = props.state;

    if (!hovering) return hide();

    // After shown: any pointer move dismisses.
    if (untrack(visible)) {
      if (x !== shownAtX || y !== shownAtY) hide();
      return;
    }

    // Pre-show: each move restarts the show timer.
    if (showTimer) clearTimeout(showTimer);
    showTimer = setTimeout(() => {
      shownAtX = x;
      shownAtY = y;
      setVisible(true);
    }, SHOW_DELAY_MS);
  });

  onCleanup(hide);

  return (
    <Show when={visible() && query.data?.userId ? query.data : undefined}>
      {(b) => (
        <div
          class="fixed z-tool-tip rounded-md bg-surface px-2 py-1 text-xs text-ink-muted/70 pointer-events-none"
          style={{
            left: `${props.state.x + 12}px`,
            top: `${props.state.y + 12}px`,
          }}
        >
          <UserLine userId={b().userId!} editedAt={b().editedAt} />
        </div>
      )}
    </Show>
  );
}
