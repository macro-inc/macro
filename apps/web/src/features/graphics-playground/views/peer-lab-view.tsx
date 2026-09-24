import type { GraphicsPeerLab } from '@macro-inc/graphics/loro';
import { createSignal, For, onCleanup, Show } from 'solid-js';
import { PeerCanvas } from '../components/peer-canvas';

export function PeerLabView(props: {
  lab: GraphicsPeerLab;
  onReset: () => void;
}) {
  const [status, setStatus] = createSignal(props.lab.status());
  onCleanup(props.lab.subscribe(() => setStatus(props.lab.status())));
  const frameConflicts = () => {
    status();
    return props.lab.peers.flatMap((peer) =>
      peer.backend.getFrameConflicts().map((id) => `${peer.name}: ${id}`)
    );
  };
  return (
    <div class="flex size-full min-h-0 flex-col gap-3 overflow-auto bg-panel p-3 text-ink">
      <div class="flex flex-wrap items-center gap-3 text-xs">
        <strong class="mr-auto text-sm">Two peers · one scene</strong>
        <button
          type="button"
          aria-pressed={status().connected}
          class="rounded border border-edge-muted px-3 py-1.5 aria-pressed:bg-accent aria-pressed:text-accent-contrast"
          onClick={() => props.lab.setConnected(!status().connected)}
        >
          {status().connected ? 'Go offline' : 'Reconnect'}
        </button>
        <button
          type="button"
          disabled={!status().pending}
          class="rounded border border-edge-muted px-3 py-1.5 disabled:opacity-40"
          onClick={() => props.lab.syncNow()}
        >
          Sync now
        </button>
        <label class="flex items-center gap-2">
          Delivery delay
          <select
            class="rounded border border-edge-muted bg-input p-1"
            value={status().latency}
            onChange={(event) =>
              props.lab.setLatency(Number(event.currentTarget.value))
            }
          >
            <option value={0}>None</option>
            <option value={500}>500 ms</option>
            <option value={1500}>1.5 s</option>
          </select>
        </label>
        <button
          type="button"
          class="rounded border border-edge-muted px-3 py-1.5"
          onClick={props.onReset}
        >
          Reset both peers
        </button>
      </div>
      <p role="status" class="text-xs text-ink-muted">
        {status().connected ? 'Connected' : 'Offline'} · {status().pending}{' '}
        queued · {status().delivered} delivered
      </p>
      <div class="flex min-h-96 flex-1 gap-3">
        <For each={props.lab.peers}>
          {(peer) => (
            <PeerCanvas
              name={peer.name}
              editor={peer.editor}
              presence={peer.presence}
            />
          )}
        </For>
      </div>
      <p class="text-xs text-ink-muted">
        Try going offline, moving a shape as Alice and changing its fill as Bob,
        then syncing. Colored cursors, selections and ghost previews show the
        other peer’s pending action while connected. Undo belongs to each peer.
        Drag edits commit on release; incoming edits cancel an active drag. Use
        Layers to select nested items and change their order or parent.
        Everything resets on reload.
      </p>
      <Show when={frameConflicts().length}>
        <p role="status" class="text-xs text-ink-muted">
          Conflicting group changes left these items fixed in place:{' '}
          {frameConflicts().join(', ')}. Moving an affected item attaches its
          position to its current group again.
        </p>
      </Show>
    </div>
  );
}
