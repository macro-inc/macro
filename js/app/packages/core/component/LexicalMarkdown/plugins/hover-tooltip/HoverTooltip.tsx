import { UserIcon } from '@core/component/UserIcon';
import { syncServiceClient } from '@service-sync/client';
import { macroIdToEmail, tryMacroId, useDisplayNameParts } from '@core/user';
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

const SHOW_DELAY_MS = 600;

function formatRelativeTime(date: Date): string {
  const sec = Math.floor((Date.now() - date.getTime()) / 1000);
  if (sec < 60) return 'just now';
  const min = Math.floor(sec / 60);
  if (min < 60) return `${min} minute${min === 1 ? '' : 's'} ago`;
  const hr = Math.floor(min / 60);
  if (hr < 24) return `${hr} hour${hr === 1 ? '' : 's'} ago`;
  const day = Math.floor(hr / 24);
  if (day < 7) return `${day} day${day === 1 ? '' : 's'} ago`;
  return date.toLocaleDateString();
}

function UserLine(props: { userId: string; editedAt: Date }) {
  const macroId = tryMacroId(props.userId);
  const { firstName } = useDisplayNameParts(macroId);
  const name = () =>
    firstName() ||
    (macroId ? macroIdToEmail(macroId).split('@')[0] : props.userId);

  return (
    <span class="inline-flex items-center gap-1">
      <UserIcon
        id={props.userId}
        size="sm"
        suppressClick
        showTooltip={false}
      />
      {name()}, {formatRelativeTime(props.editedAt)}
    </span>
  );
}

export function HoverTooltip(props: {
  state: Store<HoverTooltipState>;
  documentId: string;
}) {
  const [visible, setVisible] = createSignal(false);
  let shownAtX = 0;
  let shownAtY = 0;
  let timer: ReturnType<typeof setTimeout> | null = null;

  const hide = () => {
    if (timer) {
      clearTimeout(timer);
      timer = null;
    }
    setVisible(false);
  };

  const [blame] = createResource(
    () => (props.state.hovering ? props.state.nodeId : null),
    async (nodeId) => {
      const res = await syncServiceClient.getNodeBlame({
        documentId: props.documentId,
        nodeId,
      });
      return res.isOk() ? res.value : null;
    }
  );

  createEffect(() => {
    const { hovering, x, y } = props.state;

    if (!hovering) return hide();

    // After shown: any pointer move dismisses.
    if (untrack(visible)) {
      if (x !== shownAtX || y !== shownAtY) hide();
      return;
    }

    // Pre-show: each move restarts the timer. It only fires when the cursor settles.
    if (timer) clearTimeout(timer);
    timer = setTimeout(() => {
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
