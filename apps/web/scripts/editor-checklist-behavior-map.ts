// Collector cases use real nodes; planner cases use supplied task facts.
// No controls-menu, task-query or native hosting acceptance is established.
export const EDITOR_CHECKLIST_BEHAVIOR_MAP = [
  {
    source:
      'apps/web/src/lib/core/component/LexicalMarkdown/plugins/checklist-controls/collect.ts',
    anchor: 'export function $collectChecklistMeta()',
    testFile:
      'apps/web/src/lib/core/component/LexicalMarkdown/plugins/checklist-controls/collect.test.ts',
    cases: [
      'task-list controls collects every checklist, but only task mentions make items tasks',
      'task-list controls marks only items that mention a task',
      'task-list controls drops the task marker when the mention is replaced with plain text',
    ],
  },
  {
    source:
      'apps/web/src/lib/core/component/LexicalMarkdown/plugins/checklist-controls/model.ts',
    anchor: 'export function planChecklist(',
    testFile:
      'apps/web/src/lib/core/component/LexicalMarkdown/plugins/checklist-controls/collect.test.ts',
    cases: [
      'task-list controls counts a ticked checkbox as done even when its task status lags',
      'task-list controls dims filtered items even when an older saved setting requests hiding them',
    ],
  },
] as const;
