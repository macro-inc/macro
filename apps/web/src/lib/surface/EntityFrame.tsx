import { useSplitPanel } from '@components/app/split-layout/layoutUtils';
import {
  type EntityLoadError,
  EntityLoadGate,
  type EntityLoadResult,
  toEntityLoadError,
} from '@core/component/EntityLoadGate';
import { useHotkeyDOMScope } from '@core/hotkey/hotkeys';
import { type Accessor, createContext, type JSX, useContext } from 'solid-js';
import { useSurface } from './SurfaceProvider';

/** Re-exported so features import one module for the frame + its error type. */
export type { EntityLoadError, EntityLoadResult };

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
  /** Rendered once data is available, with a narrowed accessor. */
  children: (data: Accessor<Data>) => JSX.Element;
};

/** Chrome facts EntityFrame owns, for feature code beneath it. */
export type SurfaceChrome = {
  /** The active hotkey scope id (split scope or the frame's own DOM scope). */
  hotkeyScope: Accessor<string>;
};

const SurfaceChromeContext = createContext<SurfaceChrome>();

/**
 * Opt-in chrome for entity surfaces: load gate, hotkey scope, and DOM
 * identity.
 */
export function EntityFrame<Data>(props: EntityFrameProps<Data>): JSX.Element {
  const surface = useSurface();
  const split = useSplitPanel();

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
    const [attachHotkeys, scopeId] = useHotkeyDOMScope('surface');
    attachFallbackHotkeyScope = attachHotkeys;
    fallbackScopeId = scopeId;
  }

  const hotkeyScope: Accessor<string> = split
    ? () => split.splitHotkeyScope
    : () => fallbackScopeId!;

  const chrome: SurfaceChrome = {
    hotkeyScope,
  };

  return (
    <SurfaceChromeContext.Provider value={chrome}>
      <div
        class="relative size-full portal-scope"
        id={`surface-${surface.id()}`}
        ref={(el) => attachFallbackHotkeyScope?.(el)}
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
