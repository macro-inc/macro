import Sliders from '@phosphor-icons/core/regular/sliders.svg';
import PencilSimple from '@phosphor-icons/core/regular/pencil-simple.svg';
import { BaseTool } from './BaseTool';
import { createToolRenderer } from './ToolRenderer';

const getHandler = createToolRenderer({
  name: 'GetEntityProperties',
  renderCall: (ctx) => (
    <BaseTool icon={Sliders} renderContext={ctx.renderContext} type="call">
      Get properties for{' '}
      <span class="text-accent">{ctx.tool.data.entity_type}</span>
    </BaseTool>
  ),
  renderResponse: (ctx) => (
    <BaseTool renderContext={ctx.renderContext} type="response">
      {ctx.toolResponse.tool.data.summary}
    </BaseTool>
  ),
});

const setHandler = createToolRenderer({
  name: 'SetEntityProperty',
  renderCall: (ctx) => (
    <BaseTool icon={PencilSimple} renderContext={ctx.renderContext} type="call">
      Update property on{' '}
      <span class="text-accent">{ctx.tool.data.entity_type}</span>
    </BaseTool>
  ),
  renderResponse: (ctx) => (
    <BaseTool renderContext={ctx.renderContext} type="response">
      {ctx.toolResponse.tool.data.message}
    </BaseTool>
  ),
});

export const getEntityPropertiesHandler = getHandler;
export const setEntityPropertyHandler = setHandler;
