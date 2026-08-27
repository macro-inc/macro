import { useAnalytics } from '@app/lib/analytics/analytics-context';
import { useSplitPanel } from '@components/app/split-layout/layoutUtils';
import type { BlockName } from '@core/block';
import {
  type EntityLoadError,
  EntityLoadGate,
  type EntityLoadResult,
  toEntityLoadError,
} from '@core/component/EntityLoadGate';
import { BlockOpenTrackingDelayContext } from '@core/context/blockOpenTracking';
import { useHotkeyDOMScope } from '@core/hotkey/hotkeys';
import { isTabFocused } from '@core/signal/tabFocus';
import { useQueryClient } from '@queries/client';
import { connectionGatewayClient } from '@service-connection/client';
import {
  type Accessor,
  createContext,
  createEffect,
  createSignal,
  type JSX,
  onCleanup,
  useContext,
} from 'solid-js';
import { match } from 'ts-pattern';
import { useSurface } from './SurfaceProvider';
import type { SurfaceName } from './specs';

/** Re-exported so features import one module for the frame + its error type. */
export type { EntityLoadError, EntityLoadResult };

const PING_INTERVAL_MS = 20_000;

/**
 * Adapt a TanStack solid-query result (reactive store) to EntityLoadResult.
 * Error normalization delegates to toEntityLoadError (ThrownResultError codes
 * UNAUTHORIZED/FORBIDDEN/NOT_FOUND/GONE; everything else → 'UNEXPECTED').
 */
export function queryLoadResult<Data>(query: {
  data: Data | undefined;
  error: unknown;
  isPending: boolean;
}): EntityLoadResult<Data> {
  return {
    data: () => query.data,
    error: () => toEntityLoadError(query.error),
    isPending: () => query.isPending,
  };
}

/** Props for the opt-in entity-surface chrome. */
export type EntityFrameProps<Data> = {
  /** Drives loading / access-error / content states. */
  result: EntityLoadResult<Data>;
  /**
   * Presence tracking via the connection gateway (open/ping/close).
   * Default false — the feature opts in (replaces liveTrackingEnabled).
   */
  liveTracking?: boolean;
  /**
   * entity_type reported to the gateway. Defaults from the surface name via
   * ts-pattern match: 'chat' → 'chat', 'channel' → 'channel',
   * 'project' → 'project', otherwise 'document'.
   */
  trackAs?: 'document' | 'chat' | 'channel' | 'project';
  /**
   * Entity-open analytics + history recording on first data arrival
   * (trackBlockOpened + pageView + open_entity), honoring
   * BlockOpenTrackingDelayContext, skipped when nested.
   * Default true (replaces openTrackingEnabled !== false).
   */
  openTracking?: boolean;
  /** Rendered once data is available, with a narrowed accessor. */
  children: (data: Accessor<Data>) => JSX.Element;
};

/** Chrome facts EntityFrame owns, for feature code beneath it. */
export type SurfaceChrome = {
  /** The active hotkey scope id (split scope or the frame's own DOM scope). */
  hotkeyScope: Accessor<string>;
  /** The frame's root element once mounted. */
  rootElement: Accessor<HTMLElement | undefined>;
};

const SurfaceChromeContext = createContext<SurfaceChrome>();

function defaultTrackAs(
  name: SurfaceName
): NonNullable<EntityFrameProps<unknown>['trackAs']> {
  return match(name as string)
    .with('chat', () => 'chat' as const)
    .with('channel', () => 'channel' as const)
    .with('project', () => 'project' as const)
    .otherwise(() => 'document' as const);
}

/**
 * Opt-in chrome for entity surfaces: load gate, live tracking, hotkey scope,
 * and DOM identity attributes.
 */
export function EntityFrame<Data>(props: EntityFrameProps<Data>): JSX.Element {
  const surface = useSurface();
  const analytics = useAnalytics();
  const openTrackingDelayMs = useContext(BlockOpenTrackingDelayContext);
  const split = useSplitPanel();
  const [rootElement, setRootElement] = createSignal<HTMLElement | undefined>();

  // Block commands register on the split scope: it covers the whole panel
  // (header, toolbar, the focusable panel div), so block hotkeys keep working
  // while focus sits on split chrome outside the block element, and it stays
  // active across in-split navigation. The block gets no DOM scope of its
  // own. Registrations must
  // dispose with their owner (registerHotkey does this automatically) since
  // the split scope survives split navigation.
  //
  // Only a block rendered without a split panel gets its own DOM scope,
  // attached to the block element — a scope that is never attached can never
  // activate, so commands registered to it would silently never run.
  let attachFallbackHotkeyScope: ((el: Element) => void) | undefined;
  let fallbackScopeId: string | undefined;
  if (split) {
    fallbackScopeId = split.splitHotkeyScope;
  } else {
    const [attachHotkeys, scopeId] = useHotkeyDOMScope(surface.name);
    attachFallbackHotkeyScope = attachHotkeys;
    fallbackScopeId = scopeId;
  }

  const hotkeyScope: Accessor<string> = split
    ? () => split.splitHotkeyScope
    : () => fallbackScopeId!;

  const chrome: SurfaceChrome = {
    hotkeyScope,
    rootElement,
  };

  createEffect(() => {
    if (!props.liveTracking || surface.nested) return;
    const entityId = surface.id();
    const entityType = props.trackAs ?? defaultTrackAs(surface.name);
    connectionGatewayClient.trackEntity({
      entity_type: entityType,
      entity_id: entityId,
      action: 'open',
    });
    const pingInterval = setInterval(() => {
      if (isTabFocused()) {
        connectionGatewayClient.trackEntity({
          entity_type: entityType,
          entity_id: entityId,
          action: 'ping',
        });
      }
    }, PING_INTERVAL_MS);
    onCleanup(() => {
      connectionGatewayClient.trackEntity({
        entity_type: entityType,
        entity_id: entityId,
        action: 'close',
      });
      clearInterval(pingInterval);
    });
  });

  createEffect(() => {
    if (props.openTracking === false || surface.nested) return;
    const data = props.result.data();
    if (data === undefined) return;
    const itemId = surface.id();
    const entityType = surface.name;
    const trackOpened = () => {
      void import('@core/internal/trackBlockOpened').then(({ track }) => {
        track({
          itemId,
          blockName: entityType as BlockName,
          client: useQueryClient,
        });
      });
      analytics.pageView(entityType);
      analytics.track('open_entity', {
        entityType,
        entityId: itemId,
      });
    };
    if (openTrackingDelayMs > 0) {
      const timer = setTimeout(trackOpened, openTrackingDelayMs);
      onCleanup(() => clearTimeout(timer));
    } else {
      trackOpened();
    }
  });

  return (
    <SurfaceChromeContext.Provider value={chrome}>
      <div
        class="relative size-full portal-scope"
        id={`surface-${surface.id()}`}
        data-surface={surface.name}
        data-surface-alias={surface.alias}
        ref={(el) => {
          setRootElement(el);
          attachFallbackHotkeyScope?.(el);
        }}
      >
        <div class="overflow-hidden size-full">
          <EntityLoadGate result={props.result}>
            {props.children(() => props.result.data() as Data)}
          </EntityLoadGate>
        </div>
      </div>
    </SurfaceChromeContext.Provider>
  );
}

/**
 * Chrome facts owned by the enclosing EntityFrame.
 * @throws outside an EntityFrame subtree.
 */
export function useSurfaceChrome(): SurfaceChrome {
  const ctx = useContext(SurfaceChromeContext);
  if (!ctx) {
    throw new Error('useSurfaceChrome() called outside an EntityFrame');
  }
  return ctx;
}

/** Chrome facts owned by the enclosing EntityFrame, or undefined outside one. */
export function useMaybeSurfaceChrome(): SurfaceChrome | undefined {
  return useContext(SurfaceChromeContext);
}
