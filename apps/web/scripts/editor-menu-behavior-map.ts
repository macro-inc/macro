// These are real editor/plugin unit contracts, not rendered skills UI.
// Search removal does not establish subsequent skill/PR insertion or delivery.
export const EDITOR_MENU_BEHAVIOR_MAP = [
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
