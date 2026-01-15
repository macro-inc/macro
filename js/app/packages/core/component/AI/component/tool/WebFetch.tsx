import Globe from '@phosphor-icons/core/regular/globe.svg';
import { Match, Switch } from 'solid-js';
import { BaseTool } from './BaseTool';
import { createToolRenderer } from './ToolRenderer';

// Runtime type for successful web fetch (schema differs from generated types)
type WebFetchSuccess = {
  content: {
    title?: string | null;
    source: { data: string; media_type: string; type: 'text' | 'base64' };
    citations?: { enabled: boolean } | null;
  };
  retrieved_at: string;
  url: string;
};

// Runtime type for error web fetch
type WebFetchError = {
  error_code: string;
};

function isWebFetchError(content: unknown): content is WebFetchError {
  return (
    typeof content === 'object' && content !== null && 'error_code' in content
  );
}

function isWebFetchSuccess(content: unknown): content is WebFetchSuccess {
  return typeof content === 'object' && content !== null && 'url' in content;
}

const handler = createToolRenderer({
  name: 'web_fetch',
  renderCall: (ctx) => (
    <BaseTool
      icon={Globe}
      text="Fetching"
      renderContext={ctx.renderContext}
      type="call"
    >
      <a
        href={ctx.tool.data.url}
        target="_blank"
        rel="noopener noreferrer"
        class="italic text-accent hover:underline"
      >
        {ctx.tool.data.url}
      </a>
    </BaseTool>
  ),
  renderResponse: (ctx) => {
    const content = ctx.tool.data.content as unknown;
    return (
      <BaseTool
        icon={Globe}
        text="Fetched"
        renderContext={ctx.renderContext}
        type="response"
      >
        <Switch>
          <Match when={isWebFetchError(content)}>
            <div class="text-ink-error">
              Error: {(content as WebFetchError).error_code}
            </div>
          </Match>
          <Match when={isWebFetchSuccess(content)}>
            <a
              href={(content as WebFetchSuccess).url}
              target="_blank"
              rel="noopener noreferrer"
              class="text-accent hover:underline"
            >
              {(content as WebFetchSuccess).content?.title ??
                (content as WebFetchSuccess).url}
            </a>
          </Match>
        </Switch>
      </BaseTool>
    );
  },
});

export const webFetchHandler = handler;
