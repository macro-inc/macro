import EyeIcon from '@phosphor-icons/core/regular/eye.svg';
import { BaseTool } from './BaseTool';
import { createToolRenderer } from './ToolRenderer';

const handler = createToolRenderer({
  name: 'Read',
  renderCall: (ctx) => {
    const getDisplayText = () => {
      switch (ctx.tool.data.contentType) {
        case 'document':
          return `Reading document...`;
        case 'channel':
          return `Reading channel...`;
        case 'chat-thread':
          return `Reading AI chat thread...`;
        case 'chat-message':
          return `Reading AI chat message...`;
        case 'email-thread':
          return `Reading email thread...`;
        case 'email-message':
          return `Reading email message...`;
        default:
          return 'Reading content...';
      }
    };

    return (
      <BaseTool
        type="call"
        icon={EyeIcon}
        text={getDisplayText()}
        renderContext={ctx.renderContext}
      />
    );
  },
  renderResponse: (ctx) => (
    <BaseTool
      type="response"
      icon={EyeIcon}
      text="Finished Reading"
      renderContext={ctx.renderContext}
    />
  ),
});

export const readHandler = handler;
