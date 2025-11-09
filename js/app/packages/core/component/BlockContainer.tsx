import { type BlockName, useBlockId, useBlockName } from '@core/block';
import { useHotkeyDOMScope } from '@core/hotkey/hotkeys';
import { isTabFocused } from '@core/signal/tabFocus';
import { connectionGatewayClient } from '@service-connection/client';
import {
  children,
  createEffect,
  type FlowProps,
  onCleanup,
  onMount,
} from 'solid-js';
import { blockLiveTrackingEnabledSignal } from '../internal/BlockLoader';
import {
  blockContainerMountedSignal,
  blockElementSignal,
  blockHotkeyScopeSignal,
} from '../signal/blockElement';

// TODO: handle nested state
export const getBlockElementId = (blockId: string) => `block-${blockId}`;

/** 20 seconds ping interval */
const PING_INTERVAL = 20_000;

function resolveEntityType(blockName: BlockName) {
  switch (blockName) {
    case 'chat':
      return 'chat';
    case 'channel':
      return 'channel';
    case 'project':
      return 'project';
    default:
      return 'document';
  }
}

interface BlockContainerProps extends FlowProps {
  title?: string;
}

/** @deprecated Use DocumentBlockContainer instead, it handles loading state and all kinds of great things!
 * @see DocumentBlockContainer
 * For internal use only.
 */
export function BlockContainer(props: BlockContainerProps) {
  const setElement = blockElementSignal.set;
  const setMounted = blockContainerMountedSignal.set;
  const liveTrackingEnabled = blockLiveTrackingEnabledSignal.get;
  const setHotkeyScope = blockHotkeyScopeSignal.set;
  const blockId = useBlockId();
  const blockName = useBlockName();
  let pingInterval: ReturnType<typeof setInterval>;

  function trackEntity(operation: 'open' | 'close' | 'ping') {
    if (!liveTrackingEnabled()) return;
    if (!blockId || !blockName) return;
    connectionGatewayClient.trackEntity({
      entity_type: resolveEntityType(blockName),
      entity_id: blockId,
      action: operation,
    });
  }

  onMount(() => {
    setMounted(true);
    trackEntity('open');
    pingInterval = setInterval(() => {
      if (isTabFocused()) {
        trackEntity('ping');
      }
    }, PING_INTERVAL);
  });

  onCleanup(() => {
    setMounted(false);
    trackEntity('close');
    if (pingInterval) clearInterval(pingInterval);
  });

  const resolved = children(() => props.children);
  createEffect(() => {
    const resolved_ = resolved();
    if (!(resolved_ instanceof HTMLElement)) {
      console.error('BlockContainer must be used with a single HTMLElement');
      return;
    }
    resolved_.id = getBlockElementId(blockId);
    resolved_.dataset.blockType = blockName;
    setElement(resolved_);
  });

  const [attachHotkeys, scopeId] = useHotkeyDOMScope(blockName ?? 'block');

  setHotkeyScope(scopeId);

  onMount(() => {
    const resolved_ = resolved();
    if (!(resolved_ instanceof HTMLElement)) {
      return;
    }
    attachHotkeys(resolved_);
  });

  return (
    <div class="relative size-full portal-scope">
      <div class="overflow-hidden size-full">{resolved()}</div>
    </div>
  );
}
