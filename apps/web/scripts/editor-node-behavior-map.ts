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
] as const;
