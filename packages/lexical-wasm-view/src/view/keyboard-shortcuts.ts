/**
 * Copyright (c) Meta Platforms, Inc. and affiliates.
 * MIT licensed. Lexical 0.45.0 isUndo/isRedo/isSelectAll and isExactShortcutMatch.
 * Pin: 0cfcc169296723e07de2396cd42ea3434b5b79ed.
 */
import { CommandCode } from '@macro-inc/collaboration/session/abi.generated';

type ShortcutEvent = Pick<
  KeyboardEvent,
  'key' | 'code' | 'shiftKey' | 'altKey' | 'ctrlKey' | 'metaKey'
>;

function matchesKey(event: ShortcutEvent, key: string): boolean {
  if (event.key.toLowerCase() === key) return true;
  if (event.key.length === 1 && event.key.charCodeAt(0) <= 127) return false;
  return event.code === `Key${key.toUpperCase()}`;
}

/** Match only the platform's exact modifier, preserving remapped ASCII keys. */
export function keyboardShortcut(
  event: ShortcutEvent,
  platform: string
): number {
  const apple = /Mac|iPod|iPhone|iPad/.test(platform);
  if (
    event.altKey ||
    (apple ? !event.metaKey || event.ctrlKey : !event.ctrlKey || event.metaKey)
  )
    return 0;
  if (matchesKey(event, 'z'))
    return event.shiftKey ? CommandCode.Redo : CommandCode.Undo;
  if (event.shiftKey) return 0;
  if (!apple && matchesKey(event, 'y')) return CommandCode.Redo;
  if (matchesKey(event, 'a')) return CommandCode.SelectAll;
  return 0;
}

/**
 * Macro keyboardShortcutsPlugin DefaultShortcuts: the physical key with the
 * platform Control-or-Meta key, ignoring the other modifiers it ignores.
 * Returns the FormatText argument (TextFormatType index), or undefined.
 */
export function macroFormatShortcut(
  event: ShortcutEvent,
  platform: string
): number | undefined {
  const apple = /Mac|iPod|iPhone|iPad/.test(platform);
  if (!(apple ? event.metaKey : event.ctrlKey)) return undefined;
  if (event.code === 'KeyX' && event.shiftKey) return 2;
  if (event.code === 'KeyE') return 4;
  if (event.code === 'KeyH') return 7;
  return undefined;
}
