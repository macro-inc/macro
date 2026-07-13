import MacroLogo from '@icon/macro.svg';
import { BaseTool } from './BaseTool';
import { createToolRenderer } from './ToolRenderer';

/**
 * `SelfKnowledge` renders as a standard tool row: the Macro mark and a "Self
 * knowledge" label. The about-Macro page it returns is self-reflection the
 * model did, not an action the user needs to inspect, so the result is hidden
 * and the row has no expand toggle.
 */
const handler = createToolRenderer({
  name: 'SelfKnowledge',
  render: (ctx) => (
    <BaseTool icon={MacroLogo} renderContext={ctx.renderContext} type="call">
      Self knowledge
    </BaseTool>
  ),
});

export const selfKnowledgeHandler = handler;
