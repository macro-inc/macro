import type { NamedTool } from '@service-cognition/generated/tools/tool';
import { Match, Show, Switch } from 'solid-js';
import { SentEmailResponse } from './SendEmail';
import { createToolRenderer } from './ToolRenderer';

type SendConfirmedEmailResponse = NamedTool<
  'SendConfirmedEmail',
  'response'
>['data'];

/**
 * `SendConfirmedEmail` sends on a confirmation the user already gave in a
 * conversation thread, so there is no pending composer and no review to
 * render: the response is the send itself, shown the way `SendEmail` shows
 * its finished send.
 *
 * Only `sent` is reachable. The tool runs server-side in the agent loop,
 * with no composer to turn the send into a draft or hand it to the user to
 * edit; those outcomes belong to `SendEmail`'s client-side finish alone.
 */
function getSentResponse(response: SendConfirmedEmailResponse | undefined) {
  if (typeof response === 'object' && response !== null && 'sent' in response) {
    return response.sent;
  }
  return null;
}

const handler = createToolRenderer({
  name: 'SendConfirmedEmail',
  render: (ctx) => {
    const response = () => ctx.response?.data;
    const args = ctx.tool.data;
    const sentResponse = getSentResponse(response());

    return (
      <Show when={ctx.response}>
        <Switch>
          <Match when={sentResponse}>
            <SentEmailResponse
              args={args}
              chatId={ctx.chat_id}
              messageId={ctx.message_id}
              renderContext={ctx.renderContext}
              threadId={sentResponse!.thread_id}
              toolCallId={ctx.tool.id}
            />
          </Match>
        </Switch>
      </Show>
    );
  },
});

export const sendConfirmedEmailHandler = handler;
