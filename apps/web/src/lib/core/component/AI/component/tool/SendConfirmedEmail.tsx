import type { NamedTool } from '@service-cognition/generated/tools/tool';
import { Match, Show, Switch } from 'solid-js';
import { BaseTool } from './BaseTool';
import { DraftEmailResponse, SentEmailResponse } from './SendEmail';
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
 */
function getSentResponse(response: SendConfirmedEmailResponse | undefined) {
  if (typeof response === 'object' && response !== null && 'sent' in response) {
    return response.sent;
  }
  return null;
}

function getDraftResponse(response: SendConfirmedEmailResponse | undefined) {
  if (
    typeof response === 'object' &&
    response !== null &&
    'convertedToDraft' in response
  ) {
    return response.convertedToDraft;
  }
  return null;
}

const handler = createToolRenderer({
  name: 'SendConfirmedEmail',
  render: (ctx) => {
    const response = () => ctx.response?.data;
    const args = ctx.tool.data;
    const sentResponse = getSentResponse(response());
    const draftResponse = getDraftResponse(response());

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
          <Match when={draftResponse}>
            <DraftEmailResponse
              args={args}
              draftId={draftResponse!.draft_id}
              renderContext={ctx.renderContext}
            />
          </Match>
          <Match when={response() === 'userEdited'}>
            <BaseTool renderContext={ctx.renderContext} type="response">
              Email edited by the user
            </BaseTool>
          </Match>
        </Switch>
      </Show>
    );
  },
});

export const sendConfirmedEmailHandler = handler;
