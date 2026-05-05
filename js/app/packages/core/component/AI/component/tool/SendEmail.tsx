import { useSplitLayout } from '@app/component/split-layout/layout';
import { ItemPreview } from '@core/component/ItemPreview';
import { EntityIcon } from '@core/component/EntityIcon';
import CaretRight from '@icon/regular/caret-right.svg';
import type { NamedTool } from '@service-cognition/generated/tools/tool';
import type { SendEmail } from '@service-cognition/generated/tools/types';
import { Show, Match, Switch } from 'solid-js';
import { cn } from '@ui/utils/classname';
import { BaseTool } from './BaseTool';
import { createToolRenderer } from './ToolRenderer';
import { ComposeTool } from './email/ChatCompose';

type SendEmailResponse = NamedTool<'SendEmail', 'response'>['data'];

function getRecipientsLabel(data: SendEmail) {
  const recipients = [
    ...(data.to ?? []),
    ...(data.cc ?? []),
    ...(data.bcc ?? []),
  ];
  const labels = Array.from(
    new Map(
      recipients.map((recipient) => [
        recipient.email,
        recipient.name?.trim() || recipient.email,
      ])
    ).values()
  );

  if (labels.length === 0) return 'recipient';
  if (labels.length === 1) return labels[0]!;
  if (labels.length === 2) return `${labels[0]} and ${labels[1]}`;
  return `${labels[0]}, ${labels[1]}, +${labels.length - 2} more`;
}

function getUserAction(response: SendEmailResponse | undefined) {
  if (
    typeof response === 'object' &&
    response !== null &&
    'UserAction' in response
  ) {
    return response.UserAction;
  }

  return null;
}

function getSentResponse(response: SendEmailResponse | undefined) {
  const userAction = getUserAction(response);
  if (
    typeof userAction === 'object' &&
    userAction !== null &&
    'sent' in userAction
  ) {
    return userAction.sent;
  }

  return null;
}

function getDraftResponse(response: SendEmailResponse | undefined) {
  const userAction = getUserAction(response);
  if (
    typeof userAction === 'object' &&
    userAction !== null &&
    'convertedToDraft' in userAction
  ) {
    const draft = userAction.convertedToDraft;
    if (
      typeof draft === 'object' &&
      draft !== null &&
      'draft_id' in draft &&
      typeof draft.draft_id === 'string'
    ) {
      return {
        draft_id: draft.draft_id,
        thread_id:
          'thread_id' in draft && typeof draft.thread_id === 'string'
            ? draft.thread_id
            : undefined,
      };
    }
  }

  return null;
}

function DraftPreviewButton(props: {
  draftId: string;
  subject: string;
  threadId?: string;
}) {
  const { replaceOrInsertSplit } = useSplitLayout();

  return (
    <button
      class="text-ink-base text-sm ring-1 ring-edge-muted rounded-xs hover:bg-panel-hover flex flex-row h-6 px-2 justify-center items-center"
      onClick={() =>
        replaceOrInsertSplit({
          ...(props.threadId
            ? { type: 'email' as const, id: props.threadId }
            : {
                type: 'component' as const,
                id: 'email-compose',
                params: { draftID: props.draftId },
              }),
        })
      }
    >
      <div class="flex justify-start items-center w-3.5 h-3.5 mr-2">
        <EntityIcon targetType="email" size="xs" />
      </div>
      <div class="flex-1 text-left leading-5 min-w-0 truncate">
        {props.subject || 'Draft email'}
      </div>
    </button>
  );
}

function SentEmailResponse(props: {
  args: SendEmail;
  chatId: string;
  messageId: string;
  renderContext: Parameters<typeof BaseTool>[0]['renderContext'];
  threadId: string;
  toolCallId: string;
}) {
  return (
    <details class="group">
      <summary class="list-none [&::-webkit-details-marker]:hidden">
        <BaseTool renderContext={props.renderContext} type="response">
          <div class="flex items-center justify-between gap-3 text-sm text-ink">
            <div class="flex min-w-0 flex-wrap items-center gap-2">
              <span class="text-base">{`Email sent to ${getRecipientsLabel(props.args)}`}</span>
              <ItemPreview id={props.threadId} type="email" />
            </div>
            <span class="shrink-0 text-ink-muted">
              <CaretRight
                class={cn(
                  'h-4 w-4 transition-transform',
                  'group-open:rotate-90'
                )}
              />
            </span>
          </div>
        </BaseTool>
      </summary>
      <div class="mt-3">
        <ComposeTool
          chatId={props.chatId}
          initialData={props.args}
          messageId={props.messageId}
          toolCallId={props.toolCallId}
          readOnly
          header={<div class="text-xs text-ink-extra-muted/60">Email sent</div>}
        />
      </div>
    </details>
  );
}

function DraftEmailResponse(props: {
  args: SendEmail;
  draftId: string;
  renderContext: Parameters<typeof BaseTool>[0]['renderContext'];
  threadId?: string;
}) {
  return (
    <BaseTool renderContext={props.renderContext} type="response">
      <div class="flex items-center justify-between gap-3 text-sm text-ink">
        <div class="flex min-w-0 flex-wrap items-center gap-2">
          <span class="text-base">{`Email saved as draft for ${getRecipientsLabel(props.args)}`}</span>
          <DraftPreviewButton
            draftId={props.draftId}
            subject={props.args.subject}
            threadId={props.threadId}
          />
        </div>
      </div>
    </BaseTool>
  );
}

const handler = createToolRenderer({
  name: 'SendEmail',
  render: (ctx) => {
    const response = () => ctx.response?.data;
    const args = ctx.tool.data;
    const userAction = getUserAction(response());
    const sentResponse = getSentResponse(response());
    const draftResponse = getDraftResponse(response());

    return (
      <Show when={ctx.response}>
        <Switch>
          <Match
            when={
              response() === 'PendingUserExecution' ||
              userAction === 'userEdited'
            }
          >
            <ComposeTool
              chatId={ctx.chat_id}
              initialData={ctx.tool.data}
              messageId={ctx.message_id}
              toolCallId={ctx.tool.id}
              streamLocked={ctx.renderContext.isStreaming}
              header={
                ctx.renderContext.isStreaming ? (
                  <div class="text-xs text-ink-extra-muted/60">
                    Waiting for the response to finish before this email can be
                    edited.
                  </div>
                ) : undefined
              }
            />
          </Match>
          <Match when={response() === 'Rejected'}>
            <BaseTool renderContext={ctx.renderContext} type="response">
              Email send rejected
            </BaseTool>
          </Match>
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
              threadId={draftResponse!.thread_id}
            />
          </Match>
        </Switch>
      </Show>
    );
  },
});

export const sendEmailHandler = handler;
