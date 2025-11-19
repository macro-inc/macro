import type { Component, JSX } from 'solid-js';
import type { HotkeyToken } from './tokens';

export interface HotkeyCommand {
  // Used to identify the hotkey in UI elements. Needs to be unique to a particular scope.
  hotkeyToken?: HotkeyToken;
  // What scope does this hotkey belong to
  scopeId: string;
  // The hotkey strings, e.g. ['cmd+j', 'ctrl+j']
  hotkeys?: ValidHotkey[];
  // Condition to check if the hotkey command should run. This is checked on keydown/keyup. If this is fed a reactive value, any hotkey UI that displays hotkeys based on this condition will be reactively updated.
  condition?: () => boolean;
  // Description to be displayed in, e.g. the command palette.
  description: string | (() => string);
  // If true, the keyDownHandler will be run even if the input is focused.
  runWithInputFocused: boolean;
  // If the keyDownHandler returns true, we won't look for other commands with same hotkey.
  keyDownHandler?: (e?: KeyboardEvent) => boolean;
  // Optional keyUpHandler: if the keys of this hotkey are satisfied in a particular scope, the keyUpHandler will be triggered when the key is released, even if focus is lost.
  keyUpHandler?: (e: KeyboardEvent) => void;
  // This hotkey will activate the command scope with the given id.
  activateCommandScopeId?: string;
  // The priority of the command for ordering hotkey display lists. Note: registerHotkey only accepts number 1-10, but here we allow any number, so that we can sort as needed.
  displayPriority?: number;
  // If true, hotkey command can be hidden from the UI. It will still run, but will not be displayed.
  hide?: boolean | (() => boolean);
  // Optional icon to display in the command palette.
  icon?: Component<JSX.SvgSVGAttributes<SVGSVGElement>>;
}

export interface HotkeyRegistrationOptions {
  /**
   * Unique identifier for this hotkey within its scope.
   * Used to look up the hotkey for UI elements.
   */
  hotkeyToken?: HotkeyToken;

  /**
   * Keyboard shortcut keys, in the form of, e.g. 'j', 'cmd+j', or 'opt+shift+j'.
   * We use Mac modifier abbreviations (i.e. 'ctrl', 'opt', 'shift' and 'cmd').
   * Modifiers must be listed in this order: 'ctrl', 'opt', 'shift', 'cmd'.
   * 'cmd' will be translated to 'ctrl' for non-Mac users. For this reason, you should not use both 'cmd' and 'ctrl' in your hotkeys.
   * Can be a single hotkey or an array of hotkeys.
   */
  hotkey?: ValidHotkey | ValidHotkey[];

  /**
   * Optional condition to check if the hotkey command should run. This is checked on keydown/keyup. If this is fed a reactive value, any hotkey UI that displays hotkeys based on this condition will be reactively updated.
   */
  condition?: () => boolean;

  /**
   * The scopeId where this hotkey is active.
   */
  scopeId: string;

  /**
   *  Human readable description of what the hotkey does. Keep it short.
   *  Three words should generally be enough.
   *  Capitalize only the first letter!
   */
  description: string | (() => string);

  /**
   * Function called when hotkey is pressed.
   * If it returns true, the event will prevent default and stop propagation.
   */
  keyDownHandler: (e?: KeyboardEvent) => boolean;

  /**
   * Optional function called when hotkey is released.
   * This will be called even if scope is no longer active, iff the scope was active when the hotkey was initially pressed.
   */
  keyUpHandler?: () => void;

  /**
   * If true, pressing the hotkey will activate a command scope.
   * `registerHotkey` will return the scopeId of the created command scope.
   */
  activateCommandScope?: boolean;

  /**
   * If true, the keyDownHandler will be run even if the input is focused.
   */
  runWithInputFocused?: boolean;

  /**
   * The priority of the command for ordering hotkey display UI.
   * 1 is the lowest priority, 10 is the highest.
   *
   * Generally,
   * 10: Super important, show me first.
   * 1: Minimal priority.
   */
  displayPriority?: CommandDisplayPriority;
  /**
   * If true, hotkey command can be hidden from the UI. It will still run, but may not be displayed.
   * Can be either a boolean or a function that returns a boolean for reactive behavior.
   */
  hide?: boolean | (() => boolean);
  /**
   * Optional icon to display in the command palette.
   */
  icon?: Component<JSX.SvgSVGAttributes<SVGSVGElement>>;
}

export type RegisterHotkeyReturn = {
  dispose: () => void;
  commandScopeId?: string;
};

export type ScopeNodeBase = {
  scopeId: string;
  description?: string;
  parentScopeId?: string;
  childScopeIds: string[];
  // Map of hotkey -> commands
  hotkeyCommands: Map<ValidHotkey, HotkeyCommand>;
  // A list of commands that don't have hotkeys.
  unkeyedCommands: HotkeyCommand[];
  // If true, this scope is detached from the DOM tree, it's parent is global.
  detached: boolean;
};

export type DOMScopeNode = {
  type: 'dom';
  element: Element;
};

export type CommandScopeNode = {
  type: 'command';
};

export type ScopeNode = ScopeNodeBase & (DOMScopeNode | CommandScopeNode);

// 1 is the lowest priority, 10 is the highest.
// At some point it would be nice to replace this with some sort of frecency system?
// For hotkey training, you would actually want to sort them by reverse frecency.
export type CommandDisplayPriority = 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9 | 10;

// =========================================================================
// Types for Valid Hotkeys
// =========================================================================

// Is this hideous, yes. But it ensures that you can't register invalid hotkeys.
// Note: these all match event.key values, normalized to lowercase, EXCEPT for space, which is rendered here as 'space'. ' ' gets translated to 'space' in normalizeEventKeyPress().
export const baseKeyboardValues = [
  // letters
  'a',
  'b',
  'c',
  'd',
  'e',
  'f',
  'g',
  'h',
  'i',
  'j',
  'k',
  'l',
  'm',
  'n',
  'o',
  'p',
  'q',
  'r',
  's',
  't',
  'u',
  'v',
  'w',
  'x',
  'y',
  'z',
  // digits
  '0',
  '1',
  '2',
  '3',
  '4',
  '5',
  '6',
  '7',
  '8',
  '9',
  // punctuation
  '[',
  ']',
  ';',
  "'",
  ',',
  '.',
  '/',
  '\\',
  '`',
  '-',
  '=',
  // shift punctuation
  '!',
  '@',
  '#',
  '$',
  '%',
  '^',
  '&',
  '*',
  '(',
  ')',
  '_',
  '+',
  ':',
  '|',
  '"',
  '<',
  '>',
  '?',
  '~',
  '{',
  '}',
  // control/navigation
  'tab',
  'enter',
  'space',
  'backspace',
  'escape',
  'delete',
  'arrowup',
  'arrowdown',
  'arrowleft',
  'arrowright',
  'home',
  'end',
  'pageup',
  'pagedown',
  // function keys
  'f1',
  'f2',
  'f3',
  'f4',
  'f5',
  'f6',
  'f7',
  'f8',
  'f9',
  'f10',
  'f11',
  'f12',
] as const;

export function isBaseKeyboardValue(value: string): value is BaseKeyboardValue {
  return (baseKeyboardValues as readonly string[]).includes(value);
}

export type BaseKeyboardValue = (typeof baseKeyboardValues)[number];
export type ValidHotkey =
  | BaseKeyboardValue
  | 'ctrl'
  | 'opt'
  | 'shift'
  | 'cmd'
  | 'ctrl+opt'
  | 'ctrl+shift'
  | 'opt+shift'
  | 'opt+cmd'
  | 'shift+cmd'
  | 'ctrl+opt+shift'
  | 'opt+shift+cmd'
  | `ctrl+${BaseKeyboardValue}`
  | `ctrl+opt+${BaseKeyboardValue}`
  | `ctrl+shift+${BaseKeyboardValue}`
  | `opt+${BaseKeyboardValue}`
  | `opt+shift+${BaseKeyboardValue}`
  | `opt+cmd+${BaseKeyboardValue}`
  | `shift+${BaseKeyboardValue}`
  | `shift+cmd+${BaseKeyboardValue}`
  | `cmd+${BaseKeyboardValue}`
  | `ctrl+opt+shift+${BaseKeyboardValue}`
  | `opt+shift+cmd+${BaseKeyboardValue}`;

/**
 * Context object passed to keypress subscribers containing all relevant
 * information about the current keypress event. Subscribers can use this
 * information to implement their own filtering logic.
 */
export interface KeypressContext {
  /** The normalized hotkey string (e.g., 'cmd+j', 'j') */
  pressedKeysString: ValidHotkey;
  /** Set of currently pressed keys */
  pressedKeys: Set<string>;
  /** The raw keyboard event */
  event: KeyboardEvent;
  /** The currently active scope ID, or null if none */
  activeScopeId: string | null;
  /** Whether an editable input element is currently focused */
  isEditableFocused: boolean;
  /** Whether a command scope was activated by this keypress */
  commandScopeActivated: boolean;
  /** Whether a command was found and executed */
  commandFound: boolean;
  /** The event type ('keydown' or 'keyup') */
  eventType: 'keydown' | 'keyup';
  /** Whether the keypress includes a non-modifier key */
  isNonModifierKeypress: boolean;
}
