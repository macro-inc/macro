import type { SplitHandle } from '@components/app/split-layout/layoutManager';
import { shouldAutofocusNavigation } from '@components/app/split-layout/should-autofocus-navigation';
import { lastExecutedCommand } from '@core/hotkey/state';
import type { ValidHotkey } from '@core/hotkey/types';
import { isModality } from '@core/mobile/inputModality';

type PaneArrival = Pick<
  SplitHandle,
  'lastNavigationSource' | 'lastNavigationCause'
>;

/** Switching to a view restores its conversation; nothing opened it. */
const VIEW_SWITCH_SOURCES = new Set(['sidebar', 'hotkey', 'dock']);

const isEnter = (hotkey: ValidHotkey) =>
  hotkey === 'enter' || hotkey === 'shift+enter';

/**
 * Whether a conversation a pane has just shown takes keyboard focus in its
 * composer. A click, Enter, or Cmd+K opened it to write in; arrowing or
 * `j` / `k` through a list only previews it, so focus stays in the list.
 * Back/Forward and view switches leave focus alone, and a tap never takes it,
 * since that would raise the on-screen keyboard.
 */
export function arrivalFocusesComposer(pane: PaneArrival): boolean {
  const cause = pane.lastNavigationCause();
  if (cause === 'history-back' || cause === 'history-forward') return false;
  if (isModality('touch')) return false;

  const source = pane.lastNavigationSource();
  if (shouldAutofocusNavigation(source, cause)) return true;
  if (source && VIEW_SWITCH_SOURCES.has(source)) return false;
  if (isModality('mouse')) return true;

  return lastExecutedCommand()?.hotkeys?.some(isEnter) ?? false;
}
