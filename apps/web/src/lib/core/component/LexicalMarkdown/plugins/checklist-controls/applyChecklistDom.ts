/**
 * @file Writes a checklist plan onto the live DOM: the dim class filters
 * produce. Only touches the DOM — never Lexical state — so it is safe to
 * re-run after every reconciliation.
 */
import type { LexicalEditor, NodeKey } from 'lexical';
import type { ChecklistPlan } from './model';

export function applyChecklistDom(editor: LexicalEditor, plan: ChecklistPlan) {
  for (const row of plan.rows) {
    const el = editor.getElementByKey(row.key);
    if (!el) continue;
    el.classList.toggle('mdtl-dim', row.dimmed);
  }
}

export function clearChecklistDom(editor: LexicalEditor, rowKeys: NodeKey[]) {
  for (const key of rowKeys) {
    const el = editor.getElementByKey(key);
    if (!el) continue;
    el.classList.remove('mdtl-dim');
  }
}
