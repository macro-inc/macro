import { IS_MAC } from '@core/constant/isMac';
import { isTouchDevice } from '@core/mobile/isTouchDevice';
import { isEditableInput } from '@core/util/isEditableInput';
import { logger } from '@observability';
import { onCleanup, onMount, untrack } from 'solid-js';
import {
  EVENT_MODIFIER_KEYS,
  EVENT_MODIFIER_NAME_MAP,
  EVENT_TO_HOTKEY_NAME_MAP,
  HOTKEY_TO_EVENT_NAME_MAP,
  MODIFIER_LIST_MAC,
  MODIFIER_LIST_NON_MAC,
} from './constants';
import {
  activeScope,
  hotkeyScopeTree,
  hotkeysAwaitingKeyUp,
  hotkeyTokenMap,
  pressedKeys,
  setActiveScope,
  setHotkeyTokenMap,
  setPressedKeys,
} from './state';
import {
  HOTKEY_PRIORITY_DEFAULT,
  type HotkeyCommand,
  type HotkeyGroup,
  type HotkeyInterceptorContext,
  type HotkeyRegistrationOptions,
  isBaseKeyboardValue,
  type KeypressContext,
  type RegisterHotkeyReturn,
  type ScopeNode,
} from './types';
import {
  activateClosestDOMScope,
  findClosestParentScopeElement,
  findClosestParentScopeId,
  getKeyString,
  getScopeId,
  normalizeEventKeyPress,
  prettyPrintHotkeyString,
  registerScope,
  removeCommandsFromTokenMap,
  removeScope,
  runCommand,
} from './utils';

/**
 * Registers a keyboard shortcut to a particular, existing scope.
 *
 * Use this to bind one or more hotkeys to a scope and provide the command's
 * behavior and metadata.
 *
 * @param args - Options to configure the hotkey registration
 * @param args.hotkeyToken - Unique identifier for this hotkey within its
 * scope. Used to look up the hotkey for UI elements.
 * @param args.hotkey - Keyboard shortcut keys, e.g. 'j', 'cmd+j', or
 * 'opt+shift+j'. We use Mac modifier abbreviations ('ctrl', 'opt', 'shift',
 * 'cmd'). Modifiers must be listed in this order: 'ctrl', 'opt', 'shift',
 * 'cmd'. 'cmd' will be translated to 'ctrl' for non-Mac users. For this
 * reason, you should not use both 'cmd' and 'ctrl' in your hotkeys. Can be a
 * single hotkey or an array of hotkeys.
 * @param args.condition - Optional condition to check if the hotkey command
 * should run. Checked on keydown/keyup. If this is reactive, any hotkey UI
 * that displays based on this condition will be reactively updated.
 * @param args.scopeId - The scopeId where this hotkey is active.
 * @param args.description - Human readable description of what the hotkey
 * does. Keep it short (around three words). Can be either a string or a callback that returns a string.
 * @param args.keyDownHandler - Function called when the hotkey is pressed. If
 * it returns true, the event will prevent default and stop propagation.
 * @param args.keyUpHandler - Optional function called when the hotkey is
 * released. This will be called even if the scope is no longer active, iff the
 * scope was active when the hotkey was initially pressed.
 * @param args.activateCommandScope - If true, pressing the hotkey will
 * activate a command scope. The returned object will include the created scope
 * id as `commandScopeId`.
 * @param args.runWithInputFocused - If true, the keyDownHandler will be run
 * even if an input is focused.
 * @param args.displayPriority - The priority of the command for ordering
 * hotkey display UI. 1 is the lowest priority, 10 is the highest.
 * @param args.hide - If true, hotkey command can be hidden from the UI. It
 * will still run, but may not be displayed. Can be either a boolean or a
 * function that returns a boolean for reactive behavior.
 * @param args.icon - Optional icon to display in the command palette.
 * @param args.tags - Optional tags for categorizing in the command palette.
 * @returns An object with a dispose function to clean up the hotkey
 * registration. If `activateCommandScope` is true, it also includes the
 * `commandScopeId`.
 *
 * @example
 * // Basic usage
 * registerHotkey({
 *   scopeId: 'my-scope',
 *   description: 'Delete item',
 *   hotkey: 'delete',
 *   keyDownHandler: () => true,
 * });
 */
export function registerHotkey(
  args: HotkeyRegistrationOptions & { activateCommandScope: true }
): RegisterHotkeyReturn & { commandScopeId: string };

export function registerHotkey(
  args: HotkeyRegistrationOptions
): RegisterHotkeyReturn;

export function registerHotkey(
  args: HotkeyRegistrationOptions
): RegisterHotkeyReturn {
  const {
    hotkey,
    condition,
    scopeId,
    description,
    keyDownHandler,
    keyUpHandler,
    activateCommandScope,
    activateCommandScopeId: providedCommandScopeId,
    runWithInputFocused,
    hotkeyToken,
    displayPriority,
    handlerPriority,
    registrationType = 'override',
    hide,
    icon,
    displayComponent,
    tags,
    shouldReturnFocusOnClose,
    proxiedHotkey,
  } = args;

  const noopDisposer: RegisterHotkeyReturn = {
    dispose: () => {},
    hotkey: () => undefined,
    withGroup: (group) => {
      group.add(noopDisposer);
      return noopDisposer;
    },
  };

  if (!scopeId) {
    logger.error('Scope ID is required for hotkey registration.', {
      error: new Error('No scope ID provided'),
      scopeId,
    });
    return noopDisposer;
  }
  const scopeNode = hotkeyScopeTree.get(scopeId);
  if (!scopeNode) {
    logger.error('Scope ID not found.', {
      error: new Error('Scope ID not found'),
      scopeId,
    });
    return noopDisposer;
  }

  // Convert single hotkey to array for consistent handling
  const hotkeys = hotkey && !Array.isArray(hotkey) ? [hotkey] : hotkey;

  // Check for existing duplicate hotkeyToken for non-identical command
  const existingCommand = hotkeyToken
    ? untrack(() => hotkeyTokenMap().get(hotkeyToken)?.at(0))
    : undefined;
  if (existingCommand && hotkeys && existingCommand.hotkeys) {
    // Yes, you should be able to register multiple hotkeys with the same token. But if you do this, they should be "the same" hotkey.
    // Here we check if the existing hotkey strings are the same as the new hotkey strings. This probably isn't exactly what you'd want to check (it especially won't be right if the commmands do not have hotkey strings), but is close enough for now.
    const existingHotkeys = existingCommand.hotkeys;
    if (
      existingHotkeys.length !== hotkeys?.length ||
      !existingHotkeys.every((el, i) => el === hotkeys[i])
    ) {
      logger.log(
        `Hotkey token "${hotkeyToken}" is already registered with a different command. ` +
          `Existing: ${existingCommand.description}, New: ${description}. ` +
          `This is likely a bug, please fix it. `,
        {
          level: 'warn',
          error: new Error(
            'Hotkey token already registered with a different command'
          ),
        }
      );
    }
  }

  let commandScopeId: string | undefined;
  // If a specific command scope ID is provided, use it instead of creating a new one
  if (providedCommandScopeId) {
    const existingScope = hotkeyScopeTree.get(providedCommandScopeId);
    if (!existingScope) {
      logger.error('Provided command scope ID not found.', {
        error: new Error('Provided command scope ID not found'),
        providedCommandScopeId,
      });
      return noopDisposer;
    }
    if (existingScope.type !== 'command') {
      logger.error('Provided scope is not a command scope.', {
        error: new Error('Provided scope is not a command scope'),
        providedCommandScopeId,
        scopeType: existingScope.type,
      });
      return noopDisposer;
    }
    commandScopeId = providedCommandScopeId;
  } else if (activateCommandScope) {
    commandScopeId = getScopeId('command-scope-' + scopeId);
    // When a command scope is registered, its parent scope is set as the scopeId of the registered hotkey. It will be registered as a child of that scope. When the command scope is activated, its parent scope will get set to whatever scope is active where it was called, so that when the command scope is deactivated, it willl return to the correct scope.
    registerScope({
      parentScopeId: scopeId,
      scopeId: commandScopeId,
      type: 'command',
      activationKeys: hotkeys,
    });
  }

  const command: HotkeyCommand = {
    hotkeyToken,
    scopeId,
    hotkeys,
    condition,
    description,
    keyDownHandler,
    keyUpHandler,
    activateCommandScopeId: commandScopeId,
    runWithInputFocused: runWithInputFocused ?? false,
    displayPriority: displayPriority ?? 0,
    handlerPriority: handlerPriority ?? HOTKEY_PRIORITY_DEFAULT,
    hide,
    icon,
    displayComponent,
    tags,
    shouldReturnFocusOnClose,
    proxiedHotkey,
  };

  // Check for existing hotkeys in the scope and warn if overriding
  if (registrationType === 'override') {
    hotkeys?.forEach((h) => {
      const existingHandlers = scopeNode.hotkeyCommands.get(h);
      if (existingHandlers && existingHandlers.length > 0) {
        logger.log(
          `Hotkey ${h} already registered in scope ${scopeId}. Previous hotkey is being overwritten.`,
          {
            level: 'warn',
            error: new Error('Hotkey already registered in scope'),
          }
        );
      }
    });
  }

  if (hotkeyToken) {
    setHotkeyTokenMap((prev) => {
      const newMap = new Map(prev);
      const existingCommands = newMap.get(hotkeyToken) || [];
      newMap.set(hotkeyToken, [...existingCommands, command]);
      return newMap;
    });
  }

  if (scopeNode) {
    // Register each hotkey with the same command
    if (hotkeys) {
      hotkeys.forEach((h) => {
        const existingHandlers = scopeNode.hotkeyCommands.get(h) || [];
        if (registrationType === 'add') {
          scopeNode.hotkeyCommands.set(h, [...existingHandlers, command]);
        } else {
          // Override: replace with single-element array
          scopeNode.hotkeyCommands.set(h, [command]);
        }
      });
    } else {
      scopeNode.unkeyedCommands.push(command);
    }
  }

  const primaryHotkey = hotkeys?.[0];
  const prettyHotkey = primaryHotkey
    ? prettyPrintHotkeyString(primaryHotkey)
    : undefined;

  // Create disposer object
  const disposer: RegisterHotkeyReturn = {
    hotkey: () => prettyHotkey,
    dispose: () => {
      // Remove from hotkey token map if it exists
      if (hotkeyToken) {
        setHotkeyTokenMap((prev) =>
          removeCommandsFromTokenMap(prev, [command])
        );
      }

      // Remove this specific command from scope's hotkey handlers
      const scope = hotkeyScopeTree.get(scopeId);
      if (scope && hotkeys) {
        hotkeys.forEach((h) => {
          const existingHandlers = scope.hotkeyCommands.get(h);
          if (existingHandlers) {
            const newHandlers = existingHandlers.filter((c) => c !== command);
            if (newHandlers.length > 0) {
              scope.hotkeyCommands.set(h, newHandlers);
            } else {
              scope.hotkeyCommands.delete(h);
            }
          }
        });
      }

      // Remove command scope only if we created it (not if we're using a shared one)
      if (commandScopeId && !providedCommandScopeId) {
        removeScope(commandScopeId);
      }
    },
    commandScopeId,
    withGroup: (group) => {
      group.add(disposer);
      return disposer;
    },
  };

  return disposer;
}

/**
 * Creates a group for collecting hotkey registrations and disposing them all at once.
 *
 * @returns A group object with `add` and `dispose` methods
 *
 * @example
 * ```tsx
 * const group = createHotkeyGroup();
 *
 * // Add registrations using group.add()
 * group.add(registerHotkey({
 *   scopeId: 'my-scope',
 *   description: 'Delete item',
 *   hotkey: 'delete',
 *   keyDownHandler: () => true,
 * }));
 *
 * // Or use .withGroup() on the registration
 * registerHotkey({
 *   scopeId: 'my-scope',
 *   description: 'Copy item',
 *   hotkey: 'cmd+c',
 *   keyDownHandler: () => true,
 * }).withGroup(group);
 *
 * // Access commandScopeId naturally
 * const { commandScopeId } = group.add(registerHotkey({
 *   scopeId: 'my-scope',
 *   description: 'Open menu',
 *   hotkey: 'cmd+k',
 *   activateCommandScope: true,
 *   keyDownHandler: () => true,
 * }));
 *
 * group.add(registerHotkey({
 *   scopeId: commandScopeId,
 *   description: 'Menu option',
 *   hotkey: '1',
 *   keyDownHandler: () => true,
 * }));
 *
 * // Dispose all at once
 * onCleanup(() => group.dispose());
 * ```
 */
export function createHotkeyGroup(): HotkeyGroup {
  const disposers: (() => void)[] = [];

  return {
    add: <T extends RegisterHotkeyReturn>(registration: T): T => {
      disposers.push(() => registration.dispose());
      return registration;
    },
    addDisposer: (dispose) => {
      disposers.push(dispose);
    },
    dispose: () => {
      for (const fn of disposers) {
        fn();
      }
      disposers.length = 0;
    },
  };
}

// Variables for tracking event propagation
let scopeActivatedByFocusIn = false;

/**
 * Attaches hotkeys to a DOM element. Manages scope activation and deactivation based on focus events.
 * This is the correct way to attach hotkeys to a block.
 * @param {string} scopePrefix - Optional scope prefix for debugging purposes.
 * @param {boolean} detachedScope - If true, the scope will be attached directly to global scope.
 * @returns {[attachFn: (el: Element) => void, scopeId: string]} A tuple containing:
 *   - attachFn: Function to attach hotkey handlers to a DOM element
 *   - scopeId: The unique scope identifier that can be used with registerHotkey
 *
 *  * @example
 * ```tsx
 * function MyComponent() {
 *   const [attachHotkeys, scope] = useHotkeyDOMScope('mycomponent');
 *
 *   onMount(() => {
 *     attachHotkeys(ref()!);
 *   });
 *
 *   registerHotkey('delete', scope, 'Delete item', handleDelete);
 *
 *   return <div ref={ref}>...</div>;
 * }
 * ```
 */
export function useHotkeyDOMScope(
  scopePrefix?: string,
  detachedScope: boolean = false
): [(el: Element) => void, string] {
  const scopeId = getScopeId(scopePrefix);
  // Initially register the scope as a child of the global scope.
  // Once we attach the scope to a DOM element, we will update the parent scope to the closest parent scope, as well as updating the element in the ScopeNode.
  registerScope({
    parentScopeId: detachedScope ? undefined : 'global',
    scopeId,
    type: 'dom',
    detached: detachedScope,
  });

  const handleFocusIn = (e: Event) => {
    window.clearTimeout(focusoutTimoutId);

    // just in case focusin fires before focusout
    window.setTimeout(() => {
      window.clearTimeout(focusoutTimoutId);
    });

    const scopeNode = hotkeyScopeTree.get(scopeId);
    if (scopeNode && !scopeActivatedByFocusIn) {
      setActiveScope(scopeId);
      if (e.currentTarget instanceof Element) {
        repairScopeBranch(scopeNode, e.currentTarget);
      }
      scopeActivatedByFocusIn = true;
    }
  };

  // Runs up the DOM tree, repairing the scope tree parent/child relationship of each DOM scope parent found.
  const repairScopeBranch = (scopeNode: ScopeNode, scopeDOM: Element) => {
    let currentScope = scopeNode;
    let currentDOM: Element | null | undefined = scopeDOM;
    while (currentScope.scopeId !== 'global' && currentDOM) {
      // If the scope is detached, we can stop.
      if (currentScope.detached) {
        break;
      }
      const parentScopeId = findClosestParentScopeId(currentDOM);
      const parentScope = hotkeyScopeTree.get(parentScopeId);
      if (!parentScope) break;
      parentScope.childScopeIds.push(currentScope.scopeId);
      if (currentScope.type === 'dom') {
        currentScope.parentScopeId = parentScopeId;
      }
      currentScope = parentScope;
      const parentElement = findClosestParentScopeElement(currentDOM);
      currentDOM = parentElement;
    }
  };

  const attachFn = (el: Element) => {
    if (!el)
      return console.error(
        'Trying to attach hotkeys to an element that does exist.'
      );
    const DOMScope = hotkeyScopeTree.get(scopeId);
    // Attach this scope to the closest parent scope.
    // Note: this only works in "ideal" circumstances, where children are attached sequentially after parents. This is not always the case.
    let parentScopeId;
    if (!detachedScope) {
      parentScopeId = findClosestParentScopeId(el);
      const parentScope = hotkeyScopeTree.get(parentScopeId);
      if (parentScope) {
        parentScope.childScopeIds.push(scopeId);
      }
    }
    if (DOMScope?.type === 'dom') {
      DOMScope.parentScopeId = parentScopeId;
    }

    el.addEventListener('focusin', handleFocusIn);

    const currentDataAttribute = el.getAttribute('data-hotkey-scope');
    if (currentDataAttribute) {
      logger.error(
        `Attempting to attach ${scopeId} hotkey scope, but the specified element already has a hotkey scope attached to it. This is an error and will break the hotkey scope tree. Please use that scope, ${currentDataAttribute}, instead of inventing your own.`
      );
    }
    el.setAttribute('data-hotkey-scope', scopeId);

    onCleanup(() => {
      el.removeEventListener('focusin', handleFocusIn);
    });
  };

  onCleanup(() => {
    removeScope(scopeId);
  });

  return [attachFn, scopeId];
}

export function attachGlobalDOMScope(el: Element) {
  const handleFocusIn = () => {
    window.clearTimeout(focusoutTimoutId);

    // just in case focusin fires before focusout
    window.setTimeout(() => {
      window.clearTimeout(focusoutTimoutId);
    });

    if (!scopeActivatedByFocusIn) {
      setActiveScope('global');
    }
    scopeActivatedByFocusIn = false;
  };

  el.addEventListener('focusin', handleFocusIn);

  const currentDataAttribute = el.getAttribute('data-hotkey-scope');
  if (currentDataAttribute) {
    logger.error(
      `Attempting to attach global hotkey scope, but the specified element already has a hotkey scope attached to it. This is an error and will break the hotkey scope tree. Please use that scope, ${currentDataAttribute}, instead of inventing your own.`
    );
  }
  el.setAttribute('data-hotkey-scope', 'global');

  onCleanup(() => {
    el.removeEventListener('focusin', handleFocusIn);
  });
}

/**
 * Attaches global hotkey handlers to the document element.
 * @returns A function to subscribe to keypress events with full context information.
 */
export function useHotKeyRoot() {
  if (isTouchDevice()) {
    return;
  }

  let onKeypress: ((context: KeypressContext) => void)[] = [];
  let onHotkeyInterceptor: ((context: HotkeyInterceptorContext) => boolean)[] =
    [];

  const handleKeyDown = (e: KeyboardEvent) => {
    document.documentElement.dataset.modality = 'keyboard';
    const key = normalizeEventKeyPress(e);

    if (key === 'dead') return;

    if (!EVENT_MODIFIER_KEYS.has(key) && isBaseKeyboardValue(key)) {
      setPressedKeys((prev) => new Set([...prev, key]));
    }

    // Handle modifier keys. We iterate thru a list of possible modifier keys.
    // When not on mac, we disclude the 'meta' key, because we are treating the 'ctrl' on non-mac as equivalent to the 'meta' key on mac.
    (IS_MAC ? MODIFIER_LIST_MAC : MODIFIER_LIST_NON_MAC).forEach(
      (mod: keyof typeof EVENT_MODIFIER_NAME_MAP) => {
        const modHotkeyName =
          EVENT_TO_HOTKEY_NAME_MAP[EVENT_MODIFIER_NAME_MAP[mod]];
        if (e[mod] && !pressedKeys().has(modHotkeyName)) {
          setPressedKeys((prev) => new Set([...prev, modHotkeyName]));
        } else if (!e[mod] && pressedKeys().has(modHotkeyName)) {
          setPressedKeys(
            (prev) =>
              new Set(Array.from(prev).filter((k) => k !== modHotkeyName))
          );
        } else if (mod === 'metaKey' && e[mod]) {
          // If command key is pressed, clear all non-modifier keys except for key pressed in this event.
          // This is a necessary, defensive step because the OS captures the key-up events when you press, e.g. 'cmd+z'
          setPressedKeys(
            (prev) =>
              new Set(
                Array.from(prev).filter(
                  (k) => k in HOTKEY_TO_EVENT_NAME_MAP || k === key
                )
              )
          );
        }
      }
    );

    checkHotKeys(e);
  };

  const handleKeyUp = (e: KeyboardEvent) => {
    const key = normalizeEventKeyPress(e);

    // if we are releasing a modifier key, release all keys, because the user may have triggered some broswer or os shortcut
    // also addresses an underlying problem of modifiers sometimes getting bugged out
    if (EVENT_MODIFIER_KEYS.has(key)) {
      setPressedKeys(new Set<string>());
    } else {
      setPressedKeys(
        (prev) => new Set(Array.from(prev).filter((k) => k !== key))
      );
    }

    checkHotKeys(e);
  };

  // Clear all pressed keys when window loses focus
  const handleWindowBlur = () => {
    setPressedKeys(new Set<string>());
  };

  onMount(() => {
    document.addEventListener('keydown', handleKeyDown, { capture: true });
    document.addEventListener('keyup', handleKeyUp, { capture: true });
    window.addEventListener('blur', handleWindowBlur);
  });

  onCleanup(() => {
    document.removeEventListener('keydown', handleKeyDown, { capture: true });
    document.removeEventListener('keyup', handleKeyUp, { capture: true });
    window.removeEventListener('blur', handleWindowBlur);
  });

  const checkHotKeys = (e: KeyboardEvent) => {
    const scopeTree = hotkeyScopeTree;
    const currentScopeId = activeScope();
    const currentPressedKeys = pressedKeys();
    if (currentPressedKeys.size === 0) {
      return;
    }
    const isEditableFocused = isEditableInput(document.activeElement);
    if (!currentScopeId) {
      return logger.error(`Could not find current hotkey scope.`, {
        error: new Error('Could not find current hotkey scope'),
        currentScopeId,
      });
    }

    const pressedKeysString = getKeyString(currentPressedKeys);

    // Call hotkey interceptor handlers before command lookup
    // If any handler returns true, capture the event and skip normal processing
    const hotkeyInterceptorContext: HotkeyInterceptorContext = {
      pressedKeysString,
      pressedKeys: currentPressedKeys,
      event: e,
      activeScopeId: currentScopeId,
      isEditableFocused: isEditableFocused ?? false,
      eventType: e.type as 'keydown' | 'keyup',
    };

    for (const callback of onHotkeyInterceptor) {
      if (callback(hotkeyInterceptorContext)) {
        e.preventDefault();
        e.stopPropagation();
        return;
      }
    }

    let scopeNode = scopeTree.get(currentScopeId);
    let commandCaptured: HotkeyCommand | undefined;
    let commandScopeActivated = false;

    while (scopeNode) {
      const commands = scopeNode.hotkeyCommands.get(pressedKeysString);
      if (commands && commands.length > 0) {
        // Sort commands by handlerPriority (higher priority first)
        const sortedCommands = [...commands].sort(
          (a, b) => (b.handlerPriority ?? 0) - (a.handlerPriority ?? 0)
        );

        // Run handlers in priority order
        for (const command of sortedCommands) {
          if (command.runWithInputFocused || !isEditableFocused) {
            const result = runCommand(
              command,
              e,
              pressedKeysString,
              scopeNode.scopeId
            );

            if (result.commandCaptured) {
              commandCaptured = result.commandCaptured;
            }
            if (result.commandScopeActivated) {
              commandScopeActivated = true;
            }

            // stops running handlers up the scope and laterally
            if (result.stopPropagation) {
              break;
            }
          }
        }
      }

      if (
        scopeNode.type === 'command' &&
        ![...currentPressedKeys].some((key) =>
          ['cmd', 'ctrl', 'opt', 'shift'].includes(key)
        )
      ) {
        // if we're in a command scope, any non-modifier input should jettison us back to closest DOM scope
        activateClosestDOMScope();
      }

      if (commandCaptured || commandScopeActivated) {
        break;
      }

      // Move up to parent scope
      scopeNode = scopeNode.parentScopeId
        ? hotkeyScopeTree.get(scopeNode.parentScopeId)
        : undefined;
    }

    if (e.type === 'keyup') {
      // check if there are any keyUpHandlers that should be triggered.
      hotkeysAwaitingKeyUp.forEach((command) => {
        const key = command.hotkey.split('+').at(-1);
        const keyReleased = key && !currentPressedKeys.has(key);

        if (keyReleased) {
          command.command?.();
          hotkeysAwaitingKeyUp.splice(hotkeysAwaitingKeyUp.indexOf(command), 1);
        }
      });
    }

    // Build context object with all relevant information
    const context: KeypressContext = {
      pressedKeysString,
      pressedKeys: currentPressedKeys,
      event: e,
      activeScopeId: currentScopeId ?? null,
      isEditableFocused: isEditableFocused ?? false,
      commandScopeActivated,
      commandFound: !!commandCaptured,
      commandCaptured: commandCaptured,
      eventType: e.type as 'keydown' | 'keyup',
      isNonModifierKeypress: ![...currentPressedKeys].every((key) =>
        ['cmd', 'ctrl', 'opt', 'shift'].includes(key)
      ),
    };

    // Notify all subscribers with the context
    onKeypress.forEach((callback) => callback(context));
  };

  return {
    /**
     * Subscribe to keypress events with full context information.
     * Subscribers receive a context object containing all relevant information.
     *
     * @param callback - Function called on every keypress.
     * @returns A cleanup function to unsubscribe from the keypress events.
     *
     * @example
     * ```ts
     * subscribeToKeypress((context) => {
     *   // Only handle non-modifier keys without scope activation
     *   if (
     *     !context.commandScopeActivated &&
     *     ![...context.pressedKeys].every((key) =>
     *       ['cmd', 'ctrl', 'opt', 'shift'].includes(key)
     *     )
     *   ) {
     *     // Handle the keypress
     *   }
     * });
     * ```
     */
    subscribeToKeypress: (callback: (context: KeypressContext) => void) => {
      onKeypress.push(callback);
      return () => {
        onKeypress = onKeypress.filter((c) => c !== callback);
      };
    },

    /**
     * Subscribe to hotkey interceptor events BEFORE command lookup.
     * Return true from the callback to capture the event and prevent
     * normal hotkey command lookup and propagation.
     *
     * @param callback - Function called before hotkey command lookup.
     *   Return true to capture the event and skip normal processing.
     * @returns A cleanup function to unsubscribe.
     *
     * @example
     * ```ts
     * addHotkeyInterceptor((context) => {
     *   // Capture unregistered keys in a specific scope
     *   if (context.activeScopeId === 'my-command-scope') {
     *     return true; // Capture and prevent propagation
     *   }
     *   return false; // Let normal processing continue
     * });
     * ```
     */
    addHotkeyInterceptor: (
      callback: (context: HotkeyInterceptorContext) => boolean
    ) => {
      onHotkeyInterceptor.push(callback);
      return () => {
        onHotkeyInterceptor = onHotkeyInterceptor.filter((c) => c !== callback);
      };
    },
  };
}

// =========================================================================
// Focusout Timeout ID
// =========================================================================

let focusoutTimoutId = 0;
