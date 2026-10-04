import type { EditOp, Unit } from '@core/docx-engine/types';

/** What a key press does in the DOCX editor. */
export type KeyAction =
  | { kind: 'ops'; ops: EditOp[]; group?: string }
  | { kind: 'undo' }
  | { kind: 'redo' }
  | { kind: 'comment' }
  | { kind: 'page'; forward: boolean; extend: boolean }
  /** Tab: indents list items at their start, else types a tab. */
  | { kind: 'tab'; forward: boolean };

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
  const move = (unit: Unit, forward: boolean): KeyAction => ({
    kind: 'ops',
    ops: [{ op: 'move', unit, forward, extend }],
  });
  switch (event.key) {
    case 'ArrowLeft':
    case 'ArrowRight': {
      const forward = event.key === 'ArrowRight';
      if (mac && event.metaKey) return move('lineBoundary', forward);
      return move(word ? 'word' : 'char', forward);
    }
    case 'ArrowUp':
    case 'ArrowDown': {
      const forward = event.key === 'ArrowDown';
      if (mac && event.metaKey) return move('document', forward);
      if (word) return move('paragraph', forward);
      return move('line', forward);
    }
    case 'Home':
    case 'End': {
      const forward = event.key === 'End';
      return move(mod ? 'document' : 'lineBoundary', forward);
    }
    case 'PageUp':
    case 'PageDown':
      return { kind: 'page', forward: event.key === 'PageDown', extend };
    case 'Backspace':
    case 'Delete': {
      const forward = event.key === 'Delete';
      const unit: Unit =
        mac && event.metaKey ? 'lineBoundary' : word ? 'word' : 'char';
      return {
        kind: 'ops',
        ops: [{ op: 'delete', forward, unit }],
        group: 'delete',
      };
    }
    case 'Enter': {
      if (mod)
        return { kind: 'ops', ops: [{ op: 'insertBreak', kind: 'page' }] };
      if (event.shiftKey)
        return { kind: 'ops', ops: [{ op: 'insertBreak', kind: 'line' }] };
      return { kind: 'ops', ops: [{ op: 'insertParagraph' }] };
    }
    case 'Tab':
      if (mod || event.altKey) return null;
      return { kind: 'tab', forward: !event.shiftKey };
    default:
      break;
  }
  if (!mod) return null;
  const letter = event.code.startsWith('Key') ? event.code.slice(3) : '';
  if (event.altKey) {
    return letter === 'M' ? { kind: 'comment' } : null;
  }
  switch (letter) {
    case 'Z':
      return event.shiftKey ? { kind: 'redo' } : { kind: 'undo' };
    case 'Y':
      return mac ? null : { kind: 'redo' };
    case 'A':
      return { kind: 'ops', ops: [{ op: 'selectAll' }] };
    case 'B':
      return { kind: 'ops', ops: [{ op: 'toggleFormat', format: 'bold' }] };
    case 'I':
      return { kind: 'ops', ops: [{ op: 'toggleFormat', format: 'italic' }] };
    case 'U':
      return {
        kind: 'ops',
        ops: [{ op: 'toggleFormat', format: 'underline' }],
      };
    case 'E':
      return { kind: 'ops', ops: [{ op: 'setParagraph', align: 'center' }] };
    case 'L':
      return event.shiftKey
        ? { kind: 'ops', ops: [{ op: 'toggleList', kind: 'bullet' }] }
        : { kind: 'ops', ops: [{ op: 'setParagraph', align: 'left' }] };
    case 'R':
      return { kind: 'ops', ops: [{ op: 'setParagraph', align: 'right' }] };
    case 'J':
      return { kind: 'ops', ops: [{ op: 'setParagraph', align: 'justify' }] };
    default:
      break;
  }
  if (event.key === '=' && event.shiftKey)
    return {
      kind: 'ops',
      ops: [{ op: 'toggleFormat', format: 'superscript' }],
    };
  if (event.key === '=')
    return { kind: 'ops', ops: [{ op: 'toggleFormat', format: 'subscript' }] };
  return null;
}
