import type { MessagePart } from '@service-agent-fold/generated/types';

/** The agent's own lookups for working in code, which people never see. */
const SUPPORT_TOOLS = new Set([
  'DescribeCodeTools',
  'ReadCodeDocs',
  'SearchTools',
  'LoadTools',
]);

/**
 * A call the agent makes to find its way around its own tools. It is not a
 * step of the work, so it renders nothing and counts as no tool; the session
 * fold leaves it out of conversation rows the same way.
 */
export function isCodeModeSupportCall(part: MessagePart): boolean {
  if (part.kind !== 'tool_use') return false;
  if (part.name.kind === 'native') return SUPPORT_TOOLS.has(part.name.name);
  return (
    (part.name.server === 'macro' || part.name.server === 'macro_internal') &&
    SUPPORT_TOOLS.has(part.name.tool)
  );
}
