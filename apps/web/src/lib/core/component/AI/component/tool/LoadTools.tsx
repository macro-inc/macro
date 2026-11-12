import { createToolRenderer } from './ToolRenderer';

/** The agent loading its own tools is not a step people see. */
export const loadToolsHandler = createToolRenderer({
  name: 'LoadTools',
  render: () => null,
});
