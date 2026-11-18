// Real editor/plugin contracts, not rendered popup/skills UI or service delivery.
// Search removal does not establish subsequent skill/PR insertion or delivery.
export const EDITOR_MENU_BEHAVIOR_MAP = [
  {
    source:
      'apps/web/src/lib/core/component/LexicalMarkdown/plugins/popup/popupPlugin.ts',
    anchor: 'function registerPopupPlugin(',
    testFile:
      'apps/web/src/lib/core/component/LexicalMarkdown/behavior-inventory/popup-selection.test.ts',
    cases: [
      'selection popup controller publishes selected text and full root-block Markdown from a real range',
      'selection popup controller hides and yields when the model selection is absent',
      'selection popup controller does not show a collapsed range without the host exception',
      'selection popup controller does not consult the empty-range exception for nonempty text',
      'selection popup controller uses the host empty-range exception=false',
      'selection popup controller uses the host empty-range exception=true',
      'selection popup controller yields when the real DOM selection has no range',
      'selection popup controller does not cache a selection rejected by the host visibility setter',
      'selection popup controller clears the cached popup selection when the model selection disappears',
      'selection popup controller yields for a real node selection instead of treating it as text',
      'selection popup controller accepts empty desktop table cells but suppresses the popup on primary touch=false',
      'selection popup controller accepts empty desktop table cells but suppresses the popup on primary touch=true',
      'selection popup controller unregisters popup selection, geometry, highlight and replacement commands on disposal',
    ],
  },
  {
    source:
      'apps/web/src/lib/core/component/LexicalMarkdown/plugins/popup/popupPlugin.ts',
    anchor: 'function $updateDomRectInSelction(',
    testFile:
      'apps/web/src/lib/core/component/LexicalMarkdown/behavior-inventory/popup-selection.test.ts',
    cases: [
      'selection popup controller recomputes live geometry but falls back to the original cached rectangle when native selection clears',
    ],
  },
  {
    source:
      'apps/web/src/lib/core/component/LexicalMarkdown/plugins/popup/popupPlugin.ts',
    anchor: '    mapRegisterDelete(',
    testFile:
      'apps/web/src/lib/core/component/LexicalMarkdown/behavior-inventory/popup-selection.test.ts',
    cases: [
      'selection popup controller hides on character deletion while yielding the deletion command',
      'selection popup controller hides on word deletion while yielding the deletion command',
      'selection popup controller hides on line deletion while yielding the deletion command',
    ],
  },
  {
    source:
      'apps/web/src/lib/core/component/LexicalMarkdown/plugins/popup/popupPlugin.ts',
    anchor: '      HIGHLIGHT_SELECTED_NODES,',
    testFile:
      'apps/web/src/lib/core/component/LexicalMarkdown/behavior-inventory/popup-selection.test.ts',
    cases: [
      'selection popup controller highlights selected root blocks and removes only the highlight after its delay',
    ],
  },
  {
    source:
      'apps/web/src/lib/core/component/LexicalMarkdown/plugins/popup/popupPlugin.ts',
    anchor: '      POPUP_REPLACE_TEXT,',
    testFile:
      'apps/web/src/lib/core/component/LexicalMarkdown/behavior-inventory/popup-selection.test.ts',
    cases: [
      'selection popup controller replaces the full partially selected block with parsed Markdown and preserves its neighbors',
      'selection popup controller handles replacement without mutation when no model selection exists',
    ],
  },
  {
    source:
      'apps/web/src/lib/core/component/LexicalMarkdown/plugins/agent-commands/agentCommandsPlugin.ts',
    anchor: '  function typeSymbolCommand()',
    testFile:
      'apps/web/src/lib/core/component/LexicalMarkdown/plugins/agent-commands/agentCommandsPlugin.test.ts',
    cases: [
      'agent slash trigger opens without advertised commands so skills can be selected',
    ],
  },
  {
    source:
      'apps/web/src/lib/core/component/LexicalMarkdown/plugins/agent-commands/agentCommandsPlugin.ts',
    anchor: '  function insertCommand(command: AgentCommandItem)',
    testFile:
      'apps/web/src/lib/core/component/LexicalMarkdown/plugins/agent-commands/agentCommandsPlugin.test.ts',
    cases: [
      'agent slash trigger inserts commands with an argument space only when needed (null)',
      'agent slash trigger inserts commands with an argument space only when needed (instructions)',
    ],
  },
  {
    source:
      'apps/web/src/lib/core/component/LexicalMarkdown/plugins/agent-commands/agentCommandsPlugin.ts',
    anchor: '      REMOVE_AGENT_COMMAND_SEARCH_COMMAND,',
    testFile:
      'apps/web/src/lib/core/component/LexicalMarkdown/plugins/agent-commands/agentCommandsPlugin.test.ts',
    cases: [
      'agent slash trigger removes the slash search before inserting skill or PR mentions',
    ],
  },
] as const;
