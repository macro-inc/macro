import type { EditOp, Unit } from '@app/lib/docx/types';
import { match as matchKey } from 'ts-pattern';

/** What a key press does in the DOCX editor. */
export type KeyAction =
  | { kind: 'ops'; ops: EditOp[]; group?: string }
  | { kind: 'undo' }
  | { kind: 'redo' }
  | { kind: 'comment' }
  | { kind: 'page'; forward: boolean; extend: boolean }
  /** Tab: indents list items at their start, else types a tab. */
  | { kind: 'tab'; forward: boolean }
  /** Opens the find bar, with the replace field. */
  | { kind: 'find'; replace: boolean }
  /** The next (or previous) match of the search. */
  | { kind: 'findNext'; forward: boolean };

type Key = Pick<
  KeyboardEvent,
  'key' | 'code' | 'shiftKey' | 'altKey' | 'ctrlKey' | 'metaKey'
>;

/**
 * The editing action for a key press, or null to let the browser handle it
 * (typed characters arrive as input events; clipboard keys as clipboard
 * events). `mac` selects the platform's modifier conventions.
 */
export function keyAction(event: Key, mac: boolean): KeyAction | null {
  const mod = mac ? event.metaKey : event.ctrlKey;
  const word = mac ? event.altKey : event.ctrlKey;
  const extend = event.shiftKey;
  const move = (unit: Unit, forward: boolean, visual = false): KeyAction => ({
    kind: 'ops',
    ops: [
      visual
        ? { op: 'move', unit, forward, extend, visual }
        : { op: 'move', unit, forward, extend },
    ],
  });
  const navigationAction = matchKey(event.key)
    .with('ArrowLeft', 'ArrowRight', (): KeyAction | null => {
      {
        // Left and right on the page (reversed in right-to-left text).
        const forward = event.key === 'ArrowRight';
        if (mac && event.metaKey) return move('lineBoundary', forward, true);
        return move(word ? 'word' : 'char', forward, true);
      }
    })
    .with('ArrowUp', 'ArrowDown', (): KeyAction | null => {
      {
        const forward = event.key === 'ArrowDown';
        if (mac && event.metaKey) return move('document', forward);
        if (word) return move('paragraph', forward);
        return move('line', forward);
      }
    })
    .with('Home', 'End', (): KeyAction | null => {
      {
        const forward = event.key === 'End';
        return move(mod ? 'document' : 'lineBoundary', forward);
      }
    })
    .with('PageUp', 'PageDown', (): KeyAction | null => {
      return { kind: 'page', forward: event.key === 'PageDown', extend };
    })
    .with('Backspace', 'Delete', (): KeyAction | null => {
      {
        const forward = event.key === 'Delete';
        const unit: Unit =
          mac && event.metaKey ? 'lineBoundary' : word ? 'word' : 'char';
        return {
          kind: 'ops',
          ops: [{ op: 'delete', forward, unit }],
          group: 'delete',
        };
      }
    })
    .with('Enter', (): KeyAction | null => {
      if (mod)
        return { kind: 'ops', ops: [{ op: 'insertBreak', kind: 'page' }] };
      if (event.shiftKey)
        return { kind: 'ops', ops: [{ op: 'insertBreak', kind: 'line' }] };
      return { kind: 'ops', ops: [{ op: 'insertParagraph' }] };
    })
    .with('Tab', (): KeyAction | null => {
      if (mod || event.altKey) return null;
      return { kind: 'tab', forward: !event.shiftKey };
    })
    .otherwise(() => undefined);
  if (navigationAction !== undefined) return navigationAction;
  if (!mod) return null;
  const letter = event.code.startsWith('Key') ? event.code.slice(3) : '';
  if (event.altKey) {
    if (letter === 'M') return { kind: 'comment' };
    // Word's note shortcuts: Ctrl+Alt+F and Ctrl+Alt+D, or Cmd+Option+F
    // and Cmd+Option+E on a Mac.
    if (letter === 'F')
      return { kind: 'ops', ops: [{ op: 'insertNote', endnote: false }] };
    if (letter === (mac ? 'E' : 'D'))
      return { kind: 'ops', ops: [{ op: 'insertNote', endnote: true }] };
    return null;
  }
  const letterAction = matchKey(letter)
    .with('Z', (): KeyAction | null => {
      return event.shiftKey ? { kind: 'redo' } : { kind: 'undo' };
    })
    .with('Y', (): KeyAction | null => {
      return mac ? null : { kind: 'redo' };
    })
    .with('A', (): KeyAction | null => {
      return { kind: 'ops', ops: [{ op: 'selectAll' }] };
    })
    .with('F', (): KeyAction | null => {
      return { kind: 'find', replace: false };
    })
    .with('G', (): KeyAction | null => {
      return { kind: 'findNext', forward: !event.shiftKey };
    })
    .with('H', (): KeyAction | null => {
      // Cmd+H hides the app on macOS, so replace is Cmd+Shift+H there.
      if (mac && !event.shiftKey) return null;
      return { kind: 'find', replace: true };
    })
    .with('B', (): KeyAction | null => {
      return { kind: 'ops', ops: [{ op: 'toggleFormat', format: 'bold' }] };
    })
    .with('I', (): KeyAction | null => {
      return { kind: 'ops', ops: [{ op: 'toggleFormat', format: 'italic' }] };
    })
    .with('U', (): KeyAction | null => {
      return {
        kind: 'ops',
        ops: [{ op: 'toggleFormat', format: 'underline' }],
      };
    })
    .with('E', (): KeyAction | null => {
      return { kind: 'ops', ops: [{ op: 'setParagraph', align: 'center' }] };
    })
    .with('L', (): KeyAction | null => {
      return event.shiftKey
        ? { kind: 'ops', ops: [{ op: 'toggleList', kind: 'bullet' }] }
        : { kind: 'ops', ops: [{ op: 'setParagraph', align: 'left' }] };
    })
    .with('R', (): KeyAction | null => {
      return { kind: 'ops', ops: [{ op: 'setParagraph', align: 'right' }] };
    })
    .with('J', (): KeyAction | null => {
      return { kind: 'ops', ops: [{ op: 'setParagraph', align: 'justify' }] };
    })
    .otherwise(() => undefined);
  if (letterAction !== undefined) return letterAction;
  if (event.key === '=' && event.shiftKey)
    return {
      kind: 'ops',
      ops: [{ op: 'toggleFormat', format: 'superscript' }],
    };
  if (event.key === '=')
    return { kind: 'ops', ops: [{ op: 'toggleFormat', format: 'subscript' }] };
  return null;
}
