import { CommentThread } from '@app/components/diff-view/comments/CommentThread';
import { StaticMarkdown } from '@core/component/LexicalMarkdown/component/core/StaticMarkdown';
import { channelTheme } from '@core/component/LexicalMarkdown/theme';
import CheckIcon from '@phosphor/check.svg';
import { Button } from '@ui';
import { For, Show } from 'solid-js';
import type { ReviewThread } from '../core/model';
import { ReviewCommentComposer } from './ReviewCommentComposer';

export function ReviewDiscussion(props: {
  thread?: ReviewThread;
  readOnly?: boolean;
  sending?: boolean;
  locked?: boolean;
  note?: string;
  draft: string;
  composing: boolean;
  onDraft: (text: string) => void;
  onSend: () => void;
  onCancel: () => void;
  onResolve: () => void;
  onReply: () => void;
}) {
  return (
    <section
      class="min-w-0 font-sans"
      aria-label={props.note ? 'Agent explanation' : 'Review thread'}
    >
      <CommentThread.Root>
        <Show when={props.note}>
          <CommentThread.Comment author="Agent">
            <StaticMarkdown
              autoLink
              markdown={props.note ?? ''}
              theme={channelTheme}
              target="internal"
              lazy={false}
            />
          </CommentThread.Comment>
        </Show>
        <For each={props.thread?.messages ?? []}>
          {(message) => (
            <CommentThread.Comment author={message.author}>
              <StaticMarkdown
                autoLink
                markdown={message.body}
                theme={channelTheme}
                target="internal"
                lazy={false}
              />
              <Show when={message.delivery}>
                <p class="mt-2 text-xs text-ink-subtle">
                  {message.delivery === 'pending'
                    ? 'Saved · waiting to reach the agent'
                    : message.delivery === 'queued'
                      ? 'Queued in this session'
                      : 'Delivery will retry'}
                </p>
              </Show>
            </CommentThread.Comment>
          )}
        </For>
        <Show
          when={props.composing}
          fallback={
            <div class="flex items-center justify-between">
              <Button
                variant="ghost"
                size="sm"
                disabled={props.readOnly}
                onClick={props.onReply}
              >
                {props.note ? 'Ask about this' : 'Reply'}
              </Button>
              <Show when={props.thread}>
                <Button
                  variant="ghost"
                  size="sm"
                  disabled={props.readOnly || props.sending}
                  onClick={props.onResolve}
                >
                  <CheckIcon />
                  {props.thread?.resolved ? 'Reopen' : 'Resolve'}
                </Button>
              </Show>
            </div>
          }
        >
          <ReviewCommentComposer
            draft={props.draft}
            readOnly={props.readOnly}
            sending={props.sending}
            locked={props.locked}
            onDraft={props.onDraft}
            onSend={props.onSend}
            onCancel={props.onCancel}
          />
        </Show>
      </CommentThread.Root>
    </section>
  );
}
