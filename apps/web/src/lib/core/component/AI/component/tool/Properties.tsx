import PencilSimple from '@phosphor-icons/core/regular/pencil-simple.svg';
import Sliders from '@phosphor-icons/core/regular/sliders.svg';
import { BaseTool } from './BaseTool';
import { createToolRenderer } from './ToolRenderer';

const getHandler = createToolRenderer({
  name: 'GetEntityProperties',
  render: (ctx) => (
    <BaseTool icon={Sliders} renderContext={ctx.renderContext} type="call">
      Get properties for{' '}
      <span class="text-ink">{ctx.tool.data.entity_type}</span>
    </BaseTool>
  ),
});

const setHandler = createToolRenderer({
  name: 'SetEntityProperty',
  render: (ctx) => (
    <BaseTool icon={PencilSimple} renderContext={ctx.renderContext} type="call">
      Update property on{' '}
      <span class="text-ink">{ctx.tool.data.entity_type}</span>
    </BaseTool>
  ),
});

export const getEntityPropertiesHandler = getHandler;
export const setEntityPropertyHandler = setHandler;
