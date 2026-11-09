// Real editor/parser lifecycle with task creation supplied at the service boundary.
// No remote task creation or host permission acceptance is established.
export const EDITOR_ASYNC_BEHAVIOR_MAP = [
  {
    source:
      'apps/web/src/lib/core/component/LexicalMarkdown/plugins/checkbox-to-task/checkboxToTaskPlugin.ts',
    anchor: 'function registerCheckboxToTaskPlugin(',
    testFile:
      'apps/web/src/lib/core/component/LexicalMarkdown/behavior-inventory/checkbox-task-conversion.test.ts',
    cases: [
      'checkbox task conversion yields a null selection without service calls or completion',
      'checkbox task conversion yields a node selection without service calls or completion',
      'checkbox task conversion completes an empty checkbox scan in a paragraph without mutation',
      'checkbox task conversion completes an empty checkbox scan in a bullet without mutation',
      'checkbox task conversion registration cleanup removes conversion availability and command handling',
      'checkbox task conversion honors an explicitly stored range after the current caret moves elsewhere',
    ],
  },
  {
    source:
      'apps/web/src/lib/core/component/LexicalMarkdown/plugins/checkbox-to-task/checkboxToTaskPlugin.ts',
    anchor: 'async function processCheckboxes(',
    testFile:
      'apps/web/src/lib/core/component/LexicalMarkdown/behavior-inventory/checkbox-task-conversion.test.ts',
    cases: [
      'checkbox task conversion converts a checked=true item with parsed title and plugin options',
      'checkbox task conversion converts a checked=false item with parsed title and plugin options',
      'checkbox task conversion starts all creations before completion and replaces successful items in one update',
      'checkbox task conversion reports empty and rejected creations while preserving failed checkbox nodes',
    ],
  },
  {
    source:
      'apps/web/src/lib/core/component/LexicalMarkdown/plugins/checkbox-to-task/checkboxToTaskPlugin.ts',
    anchor: 'function $replaceCheckboxWithMention(',
    testFile:
      'apps/web/src/lib/core/component/LexicalMarkdown/behavior-inventory/checkbox-task-conversion.test.ts',
    cases: [
      'checkbox task conversion does not resurrect a checkbox deleted before its creation result arrives',
    ],
  },
] as const;
