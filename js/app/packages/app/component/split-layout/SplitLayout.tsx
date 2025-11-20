import { useGlobalBlockOrchestrator } from '@app/component/GlobalAppState';
import { activeElement } from '@app/signal/focus';
import { Resize } from '@core/component/Resize';
import { TOKENS } from '@core/hotkey/tokens';
import {
  isRightPanelOpen,
  useBigChat,
  useToggleRightPanel,
} from '@core/signal/layout';
import { tabTitleSignal } from '@core/signal/tabTitle';
import { createElementSize } from '@solid-primitives/resize-observer';
import { useNavigate } from '@solidjs/router';
import { registerHotkey, useHotkeyDOMScope } from 'core/hotkey/hotkeys';
import {
  type Accessor,
  createEffect,
  createMemo,
  createSelector,
  createSignal,
  For,
  on,
  onCleanup,
  type Setter,
} from 'solid-js';
import { Dynamic } from 'solid-js/web';
import { fireMacroJump } from '../MacroJump';
import {
  createNavigationEntityListShortcut,
  createSoupContext,
} from '../SoupContext';
import { SplitContainer } from './components/SplitContainer';
import { SplitLayoutContext, SplitPanelContext } from './context';
import { useSplitLayout } from './layout';
import {
  createSplitLayout,
  type SplitContent,
  SplitEvent,
  type SplitEventWithType,
  type SplitHandle,
  type SplitId,
  type SplitManager,
  type SplitState,
} from './layoutManager';
import { decodePairs, focusAdjacentSplit } from './layoutUtils';

type SplitLayoutContainerProps = {
  pairs: string[];
  setManager: Setter<SplitManager | undefined>;
};

function getParentSplitId(element: Element | null) {
  if (!element || !element.isConnected) return null;
  const splitParent = element.closest('[data-split-container]');
  if (!splitParent) return null;
  const splitId = splitParent.getAttribute('data-split-id');
  if (!splitId) return null;
  return splitId as SplitId;
}

/**
 * Creates an effect that syncs the layout manager with the URL.
 *
 * @param splitManager The layout manager to sync with
 * @param pairs The accessor to the current pairs
 * @param decodedPairs The accessor to the decoded pairs
 */
function createLayoutUrlSync(
  splitManager: SplitManager,
  pairs: Accessor<string[]>,
  decodedPairs: Accessor<SplitContent[]>
) {
  const navigate = useNavigate();
  const urlLayoutDrift = createMemo(
    () => splitManager.getUrlSegments().join('/') !== pairs().join('/')
  );

  /** Syncs changes from the layout manager to the URL*/
  createEffect(
    on([() => splitManager.splits().length], () => {
      if (urlLayoutDrift()) {
        // Flush the state to the url
        navigate(`/${splitManager.getUrlSegments().join('/')}`);
      }
    })
  );

  /** Syncs changes from the URL to the layout manager */
  createEffect(
    on([pairs], () => {
      if (urlLayoutDrift()) {
        splitManager.reconcile(decodedPairs());
      }
    })
  );
}

/**
 * Manages focus / active between splits
 *
 * When a split is focused, it should become the active split.
 * When a split looses focus to a non-split element, the active split should NOT change.
 * Inserting / Removing splits are explicitly handled:
 *   - When a split is inserted, it should be focused and activated
 *   - When a split is removed, the next split should be focused
 */
function createSplitFocusTracker(props: {
  splitManager: SplitManager;
  panelRefs: Map<SplitId, HTMLDivElement>;
  splits: Accessor<ReadonlyArray<SplitState>>;
}) {
  const DEBOUNCE = 40;
  const activeSplitId = () => props.splitManager.activeSplitId();

  const currentSplitsIds = () => new Set(props.splits().map((s) => s.id));
  const lastFocusedChildBySplitId: Map<SplitId, HTMLElement | null> = new Map();
  createEffect(
    on(currentSplitsIds, (ids) => {
      for (const key of lastFocusedChildBySplitId.keys()) {
        if (!ids.has(key)) {
          lastFocusedChildBySplitId.delete(key);
        }
      }
    })
  );

  const isElementInPanel = (
    panelId: SplitId,
    element: Element | null
  ): boolean => {
    const panelRef = props.panelRefs.get(panelId);
    if (!panelRef || element === null) return false;
    return panelRef === element || panelRef.contains(element);
  };

  const focusSplitById = (id: SplitId) => {
    const splitPanelRef = props.panelRefs.get(id);
    if (!splitPanelRef) {
      console.warn(`Tried to focus split with id ${id} but it doesn't exist`);
      return;
    }

    // return if panel has a child already with focus.
    if (splitPanelRef.contains(document.activeElement)) return;

    // look for a child to return focus to.
    const child = lastFocusedChildBySplitId.get(id);
    if (child && child.isConnected) {
      child.focus();
      return;
    }

    splitPanelRef.focus();
  };

  const activateFocusedSplit = (element: Element) => {
    const splitId = activeSplitId();
    if (!splitId) return;

    const doesActiveSplitHaveFocus = isElementInPanel(splitId, element);

    if (doesActiveSplitHaveFocus) {
      return;
    }

    let splitWithFocus: SplitId | undefined;
    for (const split of props.splits()) {
      if (isElementInPanel(split.id, element)) {
        splitWithFocus = split.id;
        break;
      }
    }

    if (splitWithFocus) {
      props.splitManager.activateSplit(splitWithFocus);
    }
  };

  const findNextSplitToActivate = (splitIndex: number): SplitId | undefined => {
    const wasOnlySplit = splitIndex === 0;

    // If the removed split was the only split,
    // we automatically insert and activate a new one
    // Don't need to handle anything here
    if (wasOnlySplit) return undefined;

    const nextSplitId = props.splits()[splitIndex - 1].id;

    return nextSplitId;
  };

  const focusFromEvent = (event: SplitEventWithType) => {
    switch (event.type) {
      case SplitEvent.Insert: {
        const splitId = event.splitId;
        focusSplitById(splitId);
        break;
      }
      case SplitEvent.Remove: {
        const splitId = findNextSplitToActivate(event.splitIndex);
        if (splitId) {
          focusSplitById(splitId);
        }
        break;
      }
    }
  };

  // Both of these effects need to be debounced to prevent race conditions.
  // The button for creating a new split itself is in a SplitPanel. This means that without the debounce,
  // the button in the old split might trigger another focus event and re-active the old split.
  let focusTimeout: ReturnType<typeof setTimeout> | undefined;
  let activateTimeout: ReturnType<typeof setTimeout> | undefined;
  let lastProgrammaticActivation = 0;

  /** Listens for explicit events from layoutManager that might trigger focus changes */
  createEffect(
    on(
      () => props.splitManager.events(),
      (newEvent) => {
        if (focusTimeout) {
          clearTimeout(focusTimeout);
        }
        if (newEvent.type === SplitEvent.ReturnFocus) {
          const id = props.splitManager.activeSplitId();
          if (id) {
            focusSplitById(id);
          }
          return;
        }
        focusTimeout = setTimeout(() => {
          focusFromEvent(newEvent);
        }, DEBOUNCE);
      }
    )
  );

  /** Track when splits are programmatically activated */
  createEffect(
    on(activeSplitId, () => {
      lastProgrammaticActivation = Date.now();
    })
  );

  /** Listens for focus changes on the document */
  createEffect(
    on(activeElement, (element) => {
      if (activateTimeout) {
        clearTimeout(activateTimeout);
      }
      if (!element) return;

      const parentId = getParentSplitId(element);
      if (parentId && element instanceof HTMLElement) {
        lastFocusedChildBySplitId.set(parentId, element);
      }

      activateTimeout = setTimeout(() => {
        const timeSinceActivation = Date.now() - lastProgrammaticActivation;

        // If a split was just programmatically activated, ignore this focus change
        if (timeSinceActivation < DEBOUNCE + 50) {
          return;
        }

        activateFocusedSplit(element);
      }, DEBOUNCE);
    })
  );

  return { focusSplitById };
}

export function SplitLayoutContainer(props: SplitLayoutContainerProps) {
  const decodedPairs = () => decodePairs(props.pairs);
  const blockOrchestrator = useGlobalBlockOrchestrator();
  const splitManager = createSplitLayout(blockOrchestrator, decodedPairs());
  const [, setTabTitle] = tabTitleSignal;

  // Store a ref to each panel by id
  let panelRefs = new Map<SplitId, HTMLDivElement>();
  createEffect(
    on(splitManager.events, (event) => {
      if (event.type === SplitEvent.Remove) {
        panelRefs.delete(event.splitId);
      }
    })
  );

  const splits = createMemo(splitManager.splits);

  const activeSplitSelector = createSelector(splitManager.activeSplitId);

  createEffect(() => props.setManager(splitManager));

  onCleanup(() => props.setManager(undefined));

  createEffect(() => {
    setTabTitle(splitManager.tabTitle());
  });

  // <For> on plain ids for stable referential equality
  const ids = createMemo(() => splits().map(({ id }) => id));

  createLayoutUrlSync(splitManager, () => props.pairs, decodedPairs);
  createSplitFocusTracker({ splitManager, panelRefs, splits });

  return (
    <SplitLayoutContext.Provider value={{ manager: splitManager }}>
      <Resize.Zone direction="horizontal" gutter={8}>
        <For each={ids()}>
          {(id, index) => (
            <Resize.Panel id={id} minSize={400}>
              <SplitPanel
                split={splits()[index()]!}
                handle={splitManager.getSplit(id)!}
                active={activeSplitSelector(id)}
                setPanelRef={(panelRef) => panelRefs.set(id, panelRef)}
              />
            </Resize.Panel>
          )}
        </For>
      </Resize.Zone>
    </SplitLayoutContext.Provider>
  );
}

type SplitPanelProps = {
  split: SplitState;
  handle: SplitHandle;
  active: boolean;
  setPanelRef: (ref: HTMLDivElement) => void;
};

function SplitPanel(props: SplitPanelProps) {
  const [panelRef, setPanelRef] = createSignal<HTMLDivElement | null>(null);
  const splitManager = useSplitLayout;
  const [attachHotKeys, splitHotkeyScope] = useHotkeyDOMScope(
    `split=${props.split.id}`
  );

  const panelSize = createElementSize(panelRef);
  const [contentOffsetTop, setContentOffsetTop] = createSignal(0);

  const splitName = createMemo(() => {
    const { type, id } = props.split.content;
    if (type === 'component') return id;

    return type;
  });

  const windowScope = registerHotkey({
    scopeId: splitHotkeyScope,
    hotkey: 'w',
    description: 'Window',
    keyDownHandler: () => {
      return true;
    },
    activateCommandScope: true,
  });

  registerHotkey({
    hotkeyToken: TOKENS.global.createNewSplit,
    hotkey: '\\',
    scopeId: windowScope.commandScopeId,
    description: 'Create new split',
    keyDownHandler: () => {
      splitManager().insertSplit({ type: 'component', id: 'unified-list' });
      return true;
    },
  });

  registerHotkey({
    scopeId: windowScope.commandScopeId,
    hotkey: 'w',
    description: `Close split`,
    keyDownHandler: () => {
      props.handle.close();
      return true;
    },
    hotkeyToken: TOKENS.split.close,
  });

  registerHotkey({
    scopeId: windowScope.commandScopeId,
    hotkey: 'shift+escape',
    hotkeyToken: TOKENS.split.spotlight.toggle,
    description: `Spotlight ${splitName()}`,
    keyDownHandler: () => {
      props.handle.toggleSpotlight();
      return true;
    },
    runWithInputFocused: true,
  });

  registerHotkey({
    scopeId: splitHotkeyScope,
    hotkey: 'escape',
    hotkeyToken: TOKENS.split.spotlight.close,
    condition: () => props.handle.isSpotLight(),
    description: `Spotlight ${splitName()}`,
    keyDownHandler: () => {
      props.handle.toggleSpotlight();
      return true;
    },
    runWithInputFocused: true,
  });

  const goScope = registerHotkey({
    scopeId: splitHotkeyScope,
    hotkey: 'g',
    description: 'Go',
    keyDownHandler: () => {
      return true;
    },
    activateCommandScope: true,
    hotkeyToken: TOKENS.split.goCommand,
    displayPriority: 10,
  });

  const goScopeId = goScope.commandScopeId;

  registerHotkey({
    scopeId: goScopeId,
    hotkey: '[',
    hotkeyToken: TOKENS.split.go.back,
    condition: () => props.handle.canGoBack(),
    description: `Go back`,
    keyDownHandler: () => {
      props.handle.goBack();
      return true;
    },
  });

  registerHotkey({
    scopeId: goScopeId,
    hotkey: ']',
    hotkeyToken: TOKENS.split.go.forward,
    condition: () => props.handle.canGoForward(),
    description: `Go forward`,
    keyDownHandler: () => {
      props.handle.goForward();
      return true;
    },
  });

  const { replaceSplit } = useSplitLayout();

  registerHotkey({
    scopeId: goScopeId,
    hotkey: 'h',
    description: 'Go home',
    keyDownHandler: () => {
      replaceSplit({ type: 'component', id: 'unified-list' });
      return true;
    },
    hotkeyToken: TOKENS.split.go.home,
  });

  registerHotkey({
    scopeId: goScopeId,
    hotkey: 'e',
    description: 'Go to email',
    keyDownHandler: () => {
      replaceSplit({ type: 'component', id: 'unified-list' });
      unifiedListContext.setSelectedView('emails');
      return true;
    },
    hotkeyToken: TOKENS.split.go.email,
  });

  registerHotkey({
    scopeId: goScopeId,
    hotkey: 'i',
    description: 'Go to inbox',
    keyDownHandler: () => {
      replaceSplit({ type: 'component', id: 'unified-list' });
      unifiedListContext.setSelectedView('inbox');
      return true;
    },
    hotkeyToken: TOKENS.split.go.inbox,
  });

  registerHotkey({
    hotkeyToken: TOKENS.split.go.focusSplitRight,
    hotkey: ['arrowright', 'tab'],
    scopeId: goScopeId,
    description: 'Focus split right',
    keyDownHandler: () => {
      focusAdjacentSplit('right');
      return true;
    },
  });

  registerHotkey({
    hotkeyToken: TOKENS.split.go.focusSplitLeft,
    hotkey: ['arrowleft', 'shift+tab'],
    scopeId: goScopeId,
    description: 'Focus split left',
    keyDownHandler: () => {
      focusAdjacentSplit('left');
      return true;
    },
  });

  const [bigChatOpen, _] = useBigChat();
  const toggleRightPanel = useToggleRightPanel();

  registerHotkey({
    hotkeyToken: TOKENS.split.go.toggleRightPanel,
    hotkey: 'r',
    scopeId: goScopeId,
    description: () => {
      return isRightPanelOpen() ? 'Close AI panel' : 'Go AI panel';
    },
    keyDownHandler: () => {
      toggleRightPanel();
      return true;
    },
    condition: () => {
      return !bigChatOpen();
    },
  });

  registerHotkey({
    hotkeyToken: TOKENS.split.go.macroJump,
    hotkey: 'j',
    scopeId: goScopeId,
    description: 'Macro Jump',
    keyDownHandler: () => {
      fireMacroJump();
      return true;
    },
  });

  const unifiedListContext = createSoupContext();
  createNavigationEntityListShortcut({
    splitName,
    splitHandle: props.handle,
    splitHotkeyScope,
    unifiedListContext,
    goScopeId: goScope.commandScopeId,
  });

  // Create ephemeral preview state for unified-list component
  const isUnifiedList = createMemo(() => splitName() === 'unified-list');
  const [previewState, setPreviewState] = createSignal(false);
  const previewStateSignal: [typeof previewState, typeof setPreviewState] = [
    previewState,
    setPreviewState,
  ];

  return (
    <SplitPanelContext.Provider
      value={{
        handle: props.handle,
        splitHotkeyScope,
        unifiedListContext,
        isPanelActive: () => props.active,
        panelRef,
        panelSize,
        layoutRefs: {},
        contentOffsetTop,
        setContentOffsetTop,
        previewState: isUnifiedList() ? previewStateSignal : undefined,
      }}
    >
      <SplitContainer
        id={props.split.id}
        ref={(ref) => {
          setPanelRef(ref);
          props.setPanelRef(ref);
          attachHotKeys(ref);
        }}
      >
        <Dynamic component={props.split.mount.element} />
      </SplitContainer>
    </SplitPanelContext.Provider>
  );
}
