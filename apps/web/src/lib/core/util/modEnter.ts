/**
 * Modifier-aware Enter handling for composers that submit on a keyboard
 * shortcut rather than on a bare Enter press.
 */
type ModEnterEvent = Pick<KeyboardEvent, 'key' | 'metaKey' | 'ctrlKey'>;

/**
 * True when the event is `cmd+enter` (macOS) or `ctrl+enter` (Windows/Linux).
 *
 * Both modifiers are accepted on every platform so that external keyboards and
 * remapped layouts keep working.
 */
export const isModEnter = (event: ModEnterEvent): boolean =>
  event.key === 'Enter' && (event.metaKey || event.ctrlKey);
