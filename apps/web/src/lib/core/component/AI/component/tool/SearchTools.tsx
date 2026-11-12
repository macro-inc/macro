import { createToolRenderer } from './ToolRenderer';

/** The agent finding its own tools is not a step people see. */
export const searchToolsHandler = createToolRenderer({
  name: 'SearchTools',
  render: () => null,
});
