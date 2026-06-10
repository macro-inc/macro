import { UserIcon } from '@core/component/UserIcon';
import { macroIdToEmail, tryMacroId, useDisplayNameParts } from '@core/user';
import { formatRelativeTimestamp } from '@entity';
import { syncServiceClient } from '@service-sync/client';
import { debounce } from '@solid-primitives/scheduled';
import {
  createEffect,
  createResource,
  createSignal,
  onCleanup,
  Show,
  untrack,
} from 'solid-js';
import type { Store } from 'solid-js/store';
import type { HoverTooltipState } from './hoverTooltipPlugin';

const FETCH_DELAY_MS = 400;
const SHOW_DELAY_MS = 500;

function UserLine(props: { userId: string; editedAt: Date }) {
  const macroId = tryMacroId(props.userId);
  const { firstName } = useDisplayNameParts(macroId);
  const name = () =>
    firstName() || (macroId ? macroIdToEmail(macroId) : props.userId);

  return (
    <span class="inline-flex items-center gap-1">
      <UserIcon id={props.userId} size="sm" suppressClick showTooltip={false} />
      {name()}, {formatRelativeTimestamp(props.editedAt)}
    </span>
  );
}

export function HoverTooltip(props: {
  state: Store<HoverTooltipState>;
  documentId: string;
}) {
  const [visible, setVisible] = createSignal(false);
  // The nodeId we've actually committed to fetching for. Debounced from the
  // raw hovered nodeId so we don't fire a request the instant the cursor
  // crosses a text node.
  const [armedNodeId, setArmedNodeId] = createSignal<string | null>(null);
  let shownAtX = 0;
  let shownAtY = 0;
  let showTimer: ReturnType<typeof setTimeout> | null = null;

  const debouncedArm = debounce((nodeId: string | null) => {
    setArmedNodeId(nodeId);
  }, FETCH_DELAY_MS);

  const hide = () => {
    debouncedArm.clear();
    if (showTimer) clearTimeout(showTimer);
    showTimer = null;
    setArmedNodeId(null);
    setVisible(false);
  };

  const [blame] = createResource(armedNodeId, async (nodeId) => {
    const res = await syncServiceClient.getNodeBlame({
      documentId: props.documentId,
      nodeId,
    });
    return res.isOk() ? res.value : null;
  });

  // Drive the fetch — debounced on nodeId only, ignores cursor x/y.
  createEffect(() => {
    const nodeId = props.state.hovering ? props.state.nodeId : null;
    if (nodeId === null) {
      debouncedArm.clear();
      setArmedNodeId(null);
    } else {
      debouncedArm(nodeId);
    }
  });

  // Drive the visibility — based on cursor stillness (x/y).
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
    <Show when={visible() && blame()?.userId ? blame() : null}>
      {(b) => (
        <div
          class="fixed z-50 text-xs text-ink-secondary/70 pointer-events-none"
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
