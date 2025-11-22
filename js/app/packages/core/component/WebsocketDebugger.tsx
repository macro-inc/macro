import {
  state as cognitionState,
  ws as cognitionWs,
} from '@service-cognition/websocket';
import {
  state as connectionState,
  ws as connectionWs,
} from '@service-connection/websocket';
import {
  state as storageState,
  ws as storageWs,
} from '@service-storage/websocket';
import { WebsocketConnectionState } from '@websocket';
import { createSignal, onCleanup, onMount, Show } from 'solid-js';

const WebsocketConnectionStateLabels = {
  [WebsocketConnectionState.Connecting]: 'Connecting',
  [WebsocketConnectionState.Open]: 'Open',
  [WebsocketConnectionState.Closing]: 'Closing',
  [WebsocketConnectionState.Closed]: 'Closed',
  [WebsocketConnectionState.Reconnecting]: 'Reconnecting',
} as const;

export function WebsocketDebugger() {
  const [isExpanded, setIsExpanded] = createSignal(false);
  const [position, setPosition] = createSignal({
    x: window.innerWidth - 280,
    y: window.innerHeight - 400,
  });
  const [isDragging, setIsDragging] = createSignal(false);
  const [dragStart, setDragStart] = createSignal({ x: 0, y: 0 });
  let debuggerRef: HTMLDivElement | undefined;

  const handleMouseDown = (e: MouseEvent) => {
    if (
      e.target !== e.currentTarget &&
      !(e.target as Element).closest('.drag-handle')
    )
      return;

    setIsDragging(true);
    const rect = debuggerRef!.getBoundingClientRect();
    setDragStart({
      x: e.clientX - rect.left,
      y: e.clientY - rect.top,
    });
    e.preventDefault();
  };

  const handleMouseMove = (e: MouseEvent) => {
    if (!isDragging()) return;

    const newX = e.clientX - dragStart().x;
    const newY = e.clientY - dragStart().y;

    // Keep within viewport bounds
    const maxX = window.innerWidth - debuggerRef!.offsetWidth;
    const maxY = window.innerHeight - debuggerRef!.offsetHeight;

    setPosition({
      x: Math.max(0, Math.min(newX, maxX)),
      y: Math.max(0, Math.min(newY, maxY)),
    });
  };

  const handleMouseUp = () => {
    setIsDragging(false);
  };

  onMount(() => {
    document.addEventListener('mousemove', handleMouseMove);
    document.addEventListener('mouseup', handleMouseUp);
  });

  onCleanup(() => {
    document.removeEventListener('mousemove', handleMouseMove);
    document.removeEventListener('mouseup', handleMouseUp);
  });

  return (
    <div
      ref={debuggerRef}
      class="fixed z-50 bg-menu border border-edge rounded-xl shadow-2xl shadow-edge/20 select-none backdrop-blur-sm"
      style={{
        left: `${position().x}px`,
        top: `${position().y}px`,
        cursor: isDragging()
          ? 'var(--cursor-grabbing)'
          : 'var(--cursor-default)',
      }}
      onMouseDown={handleMouseDown}
    >
      <div class="flex items-center justify-between gap-2 p-3 bg-hover/50 rounded-t-xl cursor-grab drag-handle border-b border-edge/50">
        <span class="text-sm font-medium text-ink">WS Debug</span>
        <button
          onClick={() => setIsExpanded(!isExpanded())}
          class="px-2 py-1 text-xs font-medium text-accent-ink bg-accent/10 hover:bg-accent/20 rounded-md transition-colors duration-150"
        >
          {isExpanded() ? 'Hide' : 'Show'}
        </button>
      </div>

      <Show when={isExpanded()}>
        <div class="p-4 space-y-4 min-w-64">
          {/* Cognition WebSocket */}
          <div class="space-y-3">
            <div class="flex items-center justify-between">
              <div class="text-sm font-medium text-ink">Cognition Service</div>
              <span
                class={`text-xs font-medium px-3 py-1.5 rounded-lg ${
                  cognitionState() === WebsocketConnectionState.Open
                    ? 'bg-success-bg text-success-ink border border-success/30'
                    : cognitionState() === WebsocketConnectionState.Connecting
                      ? 'bg-alert/10 text-alert-ink border border-alert/30'
                      : 'bg-failure-bg text-failure-ink border border-failure/30'
                }`}
              >
                {WebsocketConnectionStateLabels[cognitionState()]}
              </span>
            </div>
            <div class="flex gap-2">
              <button
                onClick={() => cognitionWs.close()}
                disabled={
                  cognitionState() === WebsocketConnectionState.Closed ||
                  cognitionState() === WebsocketConnectionState.Closing
                }
                class={`flex-1 text-xs font-medium px-3 py-2 rounded-lg transition-colors duration-150 border ${
                  cognitionState() === WebsocketConnectionState.Closed ||
                  cognitionState() === WebsocketConnectionState.Closing
                    ? 'bg-edge/20 text-ink-disabled border-edge/30 cursor-not-allowed'
                    : 'bg-failure-bg hover:bg-failure text-failure-ink border-failure/30'
                }`}
              >
                Disconnect
              </button>
              <button
                onClick={() => cognitionWs.reconnect()}
                disabled={cognitionState() === WebsocketConnectionState.Open}
                class={`flex-1 text-xs font-medium px-3 py-2 rounded-lg transition-colors duration-150 border ${
                  cognitionState() === WebsocketConnectionState.Open
                    ? 'bg-edge/20 text-ink-disabled border-edge/30 cursor-not-allowed'
                    : 'bg-accent/10 hover:bg-accent/20 text-accent-ink border-accent/30'
                }`}
              >
                Reconnect
              </button>
            </div>
          </div>

          {/* Connection WebSocket */}
          <div class="space-y-3 border-t border-edge/50 pt-4">
            <div class="flex items-center justify-between">
              <div class="text-sm font-medium text-ink">Connection Service</div>
              <span
                class={`text-xs font-medium px-3 py-1.5 rounded-lg ${
                  connectionState() === WebsocketConnectionState.Open
                    ? 'bg-success-bg text-success-ink border border-success/30'
                    : connectionState() === WebsocketConnectionState.Connecting
                      ? 'bg-alert/10 text-alert-ink border border-alert/30'
                      : 'bg-failure-bg text-failure-ink border border-failure/30'
                }`}
              >
                {WebsocketConnectionStateLabels[connectionState()]}
              </span>
            </div>
            <div class="flex gap-2">
              <button
                onClick={() => connectionWs.close()}
                disabled={
                  connectionState() === WebsocketConnectionState.Closed ||
                  connectionState() === WebsocketConnectionState.Closing
                }
                class={`flex-1 text-xs font-medium px-3 py-2 rounded-lg transition-colors duration-150 border ${
                  connectionState() === WebsocketConnectionState.Closed ||
                  connectionState() === WebsocketConnectionState.Closing
                    ? 'bg-edge/20 text-ink-disabled border-edge/30 cursor-not-allowed'
                    : 'bg-failure-bg hover:bg-failure text-failure-ink border-failure/30'
                }`}
              >
                Disconnect
              </button>
              <button
                onClick={() => connectionWs.reconnect()}
                disabled={connectionState() === WebsocketConnectionState.Open}
                class={`flex-1 text-xs font-medium px-3 py-2 rounded-lg transition-colors duration-150 border ${
                  connectionState() === WebsocketConnectionState.Open
                    ? 'bg-edge/20 text-ink-disabled border-edge/30 cursor-not-allowed'
                    : 'bg-accent/10 hover:bg-accent/20 text-accent-ink border-accent/30'
                }`}
              >
                Reconnect
              </button>
            </div>
          </div>

          {/* Storage WebSocket */}
          <div class="space-y-3 border-t border-edge/50 pt-4">
            <div class="flex items-center justify-between">
              <div class="text-sm font-medium text-ink">Storage Service</div>
              <span
                class={`text-xs font-medium px-3 py-1.5 rounded-lg ${
                  storageState() === WebsocketConnectionState.Open
                    ? 'bg-success-bg text-success-ink border border-success/30'
                    : storageState() === WebsocketConnectionState.Connecting
                      ? 'bg-alert/10 text-alert-ink border border-alert/30'
                      : 'bg-failure-bg text-failure-ink border border-failure/30'
                }`}
              >
                {WebsocketConnectionStateLabels[storageState()]}
              </span>
            </div>
            <div class="flex gap-2">
              <button
                onClick={() => storageWs.close()}
                disabled={
                  storageState() === WebsocketConnectionState.Closed ||
                  storageState() === WebsocketConnectionState.Closing
                }
                class={`flex-1 text-xs font-medium px-3 py-2 rounded-lg transition-colors duration-150 border ${
                  storageState() === WebsocketConnectionState.Closed ||
                  storageState() === WebsocketConnectionState.Closing
                    ? 'bg-edge/20 text-ink-disabled border-edge/30 cursor-not-allowed'
                    : 'bg-failure-bg hover:bg-failure text-failure-ink border-failure/30'
                }`}
              >
                Disconnect
              </button>
              <button
                onClick={() => storageWs.reconnect()}
                disabled={storageState() === WebsocketConnectionState.Open}
                class={`flex-1 text-xs font-medium px-3 py-2 rounded-lg transition-colors duration-150 border ${
                  storageState() === WebsocketConnectionState.Open
                    ? 'bg-edge/20 text-ink-disabled border-edge/30 cursor-not-allowed'
                    : 'bg-accent/10 hover:bg-accent/20 text-accent-ink border-accent/30'
                }`}
              >
                Reconnect
              </button>
            </div>
          </div>
        </div>
      </Show>
    </div>
  );
}
