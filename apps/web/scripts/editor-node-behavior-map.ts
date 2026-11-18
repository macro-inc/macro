// Real mounted nodes in jsdom; toolbar sentinel is host-owned test content.
// Legacy upgrades include the production controls transform, not a bare parse.
// No native/custom-class hosting or task-list controls UI acceptance is claimed.
export const EDITOR_NODE_BEHAVIOR_MAP = [
  {
    source: 'packages/lexical-core/nodes/TaskListNode.ts',
    anchor: '  createDOM(config: EditorConfig)',
    testFile:
      'apps/web/src/lib/core/component/LexicalMarkdown/behavior-inventory/task-list-dom.test.ts',
    cases: [
      'mounted task list DOM slots mounts check lists with chrome only for checklists',
      'mounted task list DOM slots mounts number lists with chrome only for checklists',
      'mounted task list DOM slots mounts bullet lists with chrome only for checklists',
      'mounted task list DOM slots detaches the unmanaged chrome when its owning list is removed',
    ],
  },
  {
    source: 'packages/lexical-core/nodes/TaskListNode.ts',
    anchor: '  getDOMSlot(element: HTMLElement)',
    testFile:
      'apps/web/src/lib/core/component/LexicalMarkdown/behavior-inventory/task-list-dom.test.ts',
    cases: [
      'mounted task list DOM slots preserves unmanaged toolbar identity and content through a committed text edit',
      'mounted task list DOM slots preserves unmanaged toolbar identity and content through a committed append edit',
      'mounted task list DOM slots preserves unmanaged toolbar identity and content through a committed remove edit',
      'mounted task list DOM slots preserves unmanaged toolbar identity and content through a committed reorder edit',
    ],
  },
  {
    source: 'packages/lexical-core/nodes/TaskListNode.ts',
    anchor: '  exportDOM(editor: LexicalEditor)',
    testFile:
      'apps/web/src/lib/core/component/LexicalMarkdown/behavior-inventory/task-list-dom.test.ts',
    cases: [
      'mounted task list DOM slots excludes unmanaged chrome from exported clipboard HTML while retaining both item labels',
    ],
  },
  {
    source:
      'apps/web/src/lib/core/component/LexicalMarkdown/plugins/checklist-controls/checklistControlsPlugin.ts',
    anchor: '      editor.registerNodeTransform(ListNode, (node) => {',
    testFile:
      'apps/web/src/lib/core/component/LexicalMarkdown/behavior-inventory/task-list-dom.test.ts',
    cases: [
      'mounted task list DOM slots upgrades dirty legacy check list JSON through the production controls transform',
      'mounted task list DOM slots upgrades dirty legacy number list JSON through the production controls transform',
      'mounted task list DOM slots upgrades dirty legacy bullet list JSON through the production controls transform',
    ],
  },
  // The mounted subclass inherits ListNode DOM hooks; these rows pin that
  // composition, not every dependency implementation branch.
  {
    source: 'packages/lexical-core/nodes/TaskListNode.ts',
    anchor: 'export class TaskListNode extends ListNode {',
    testFile:
      'apps/web/src/lib/core/component/LexicalMarkdown/behavior-inventory/task-list-dom.test.ts',
    cases: [
      'mounted task list DOM slots replaces the list DOM and chrome when kind changes from check to bullet',
      'mounted task list DOM slots replaces the list DOM and chrome when kind changes from check to number',
      'mounted task list DOM slots replaces the list DOM and chrome when kind changes from bullet to check',
      'mounted task list DOM slots replaces the list DOM and chrome when kind changes from bullet to number',
      'mounted task list DOM slots replaces the list DOM and chrome when kind changes from number to check',
      'mounted task list DOM slots replaces the list DOM and chrome when kind changes from number to bullet',
      'mounted task list DOM slots updates an ordered start in place without replacing managed item DOM',
    ],
  },
] as const;
