// Collector cases use real nodes; planner cases use supplied task facts.
// These unit mappings do not establish controls-menu, query or native hosting
// acceptance. The separate browser fixture records its own controls evidence.
export const EDITOR_CHECKLIST_BEHAVIOR_MAP = [
  {
    source:
      'apps/web/src/lib/core/component/LexicalMarkdown/plugins/checklist-controls/collect.ts',
    anchor: 'export function $collectChecklistMeta()',
    testFile:
      'apps/web/src/lib/core/component/LexicalMarkdown/behavior-inventory/checklist-collection.test.ts',
    cases: [
      'checklist node collection collects only root checklists and excludes nested rows from progress',
      'checklist node collection deduplicates assignees by id in document order and keeps the first display name',
      'checklist node collection takes the first date and task mention while ignoring other document kinds',
      'checklist node collection assigns leading and trailing nested wrappers to the adjacent ordinary row',
      'checklist node collection recomputes trimmed text priority and clears removed inline metadata after committed edits',
    ],
  },
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
  {
    source:
      'apps/web/src/lib/core/component/LexicalMarkdown/plugins/checklist-controls/model.ts',
    anchor: 'export function dueBucket(',
    testFile:
      'apps/web/src/lib/core/component/LexicalMarkdown/behavior-inventory/checklist-control-planning.test.ts',
    cases: [
      'checklist control planning buckets missing due dates by calendar day',
      'checklist control planning buckets invalid due dates by calendar day',
      'checklist control planning buckets yesterday due dates by calendar day',
      'checklist control planning buckets same calendar day due dates by calendar day',
      'checklist control planning buckets tomorrow due dates by calendar day',
      'checklist control planning buckets seventh day due dates by calendar day',
      'checklist control planning buckets eighth day due dates by calendar day',
    ],
  },
  {
    source:
      'apps/web/src/lib/core/component/LexicalMarkdown/plugins/checklist-controls/model.ts',
    anchor: 'export function parseMarkerPriority(',
    testFile:
      'apps/web/src/lib/core/component/LexicalMarkdown/behavior-inventory/checklist-control-planning.test.ts',
    cases: [
      'checklist control planning parses no marker priority suffixes',
      'checklist control planning parses internal marker priority suffixes',
      'checklist control planning parses one marker priority suffixes',
      'checklist control planning parses two markers priority suffixes',
      'checklist control planning parses three markers priority suffixes',
      'checklist control planning parses four markers priority suffixes',
      'checklist control planning parses trailing whitespace priority suffixes',
    ],
  },
  {
    source:
      'apps/web/src/lib/core/component/LexicalMarkdown/plugins/checklist-controls/model.ts',
    anchor: 'export function effectiveItem(',
    testFile:
      'apps/web/src/lib/core/component/LexicalMarkdown/behavior-inventory/checklist-control-planning.test.ts',
    cases: [
      'checklist control planning resolves conflicting real task properties ahead of inline metadata',
      'checklist control planning falls back to checkbox checked=true and inline metadata without task data',
      'checklist control planning falls back to checkbox checked=false and inline metadata without task data',
      'checklist control planning falls back for unknown task options, empty assignees and a null task due date',
    ],
  },
  {
    source:
      'apps/web/src/lib/core/component/LexicalMarkdown/plugins/checklist-controls/model.ts',
    anchor: 'export function itemMatchesFilters(',
    testFile:
      'apps/web/src/lib/core/component/LexicalMarkdown/behavior-inventory/checklist-control-planning.test.ts',
    cases: [
      'checklist control planning applies empty filters with AND across dimensions',
      'checklist control planning applies OR within every dimension with AND across dimensions',
      'checklist control planning applies status rejection with AND across dimensions',
      'checklist control planning applies priority rejection with AND across dimensions',
      'checklist control planning applies assigned versus unassigned with AND across dimensions',
      'checklist control planning applies due rejection with AND across dimensions',
      'checklist control planning applies unassigned match with AND across dimensions',
      'checklist control planning applies unassigned rejection with AND across dimensions',
    ],
  },
  {
    source:
      'apps/web/src/lib/core/component/LexicalMarkdown/plugins/checklist-controls/model.ts',
    anchor: 'export function countActiveFilters(',
    testFile:
      'apps/web/src/lib/core/component/LexicalMarkdown/behavior-inventory/checklist-control-planning.test.ts',
    cases: [
      'checklist control planning counts selected filter choices rather than nonempty dimensions',
    ],
  },
  {
    source:
      'apps/web/src/lib/core/component/LexicalMarkdown/plugins/checklist-controls/model.ts',
    anchor: 'export function planChecklist(',
    testFile:
      'apps/web/src/lib/core/component/LexicalMarkdown/behavior-inventory/checklist-control-planning.test.ts',
    cases: [
      'checklist control planning keeps wrapper ordering and total progress independent of filtering=false',
      'checklist control planning keeps wrapper ordering and total progress independent of filtering=true',
      'checklist control planning keeps an empty filtered plan active with zero progress',
    ],
  },
  {
    source:
      'apps/web/src/lib/core/component/LexicalMarkdown/plugins/checklist-controls/applyChecklistDom.ts',
    anchor: 'export function applyChecklistDom(',
    testFile:
      'apps/web/src/lib/core/component/LexicalMarkdown/behavior-inventory/checklist-control-planning.test.ts',
    cases: [
      'checklist DOM plan application applies and clears dimming on actual mounted rows without changing saved state',
    ],
  },
  {
    source:
      'apps/web/src/lib/core/component/LexicalMarkdown/plugins/checklist-controls/applyChecklistDom.ts',
    anchor: 'export function clearChecklistDom(',
    testFile:
      'apps/web/src/lib/core/component/LexicalMarkdown/behavior-inventory/checklist-control-planning.test.ts',
    cases: [
      'checklist DOM plan application ignores stale row keys after deletion without modifying the remaining model',
    ],
  },
] as const;
