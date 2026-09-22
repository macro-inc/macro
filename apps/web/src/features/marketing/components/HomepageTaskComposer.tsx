import { EntityIcon } from '@core/component/EntityIcon';
import { buildConfig } from '@core/component/LexicalMarkdown/builder/MarkdownConfigBuilder';
import { MarkdownShell } from '@core/component/LexicalMarkdown/builder/MarkdownShell';
import { Button, ComposerSurface, SendButton } from '@ui';
import { ChatInput } from '@ui/components/ChatInput';
import { createSignal, Show } from 'solid-js';
import { HomepageMention } from './HomepageMention';

export type HomepageTaskComposerHandle = { reset: (draft: string) => void };

/** Production composer/editor primitives, with no account or send mutation. */
export function HomepageTaskComposer(props: {
  initialDraft: string;
  onSend: (message: string, asTask: boolean) => void;
  created: boolean;
  onInteract: () => void;
  onReady: (handle: HomepageTaskComposerHandle) => void;
}) {
  const [asTask, setAsTask] = createSignal(true);
  const [draft, setDraft] = createSignal(props.initialDraft);
  const send = () => {
    const message = config.controls.getMarkdown().trim();
    if (!message) return;
    config.controls.clear();
    props.onSend(message, asTask());
  };
  const config = buildConfig('chat')
    .namespace('homepage-task-composer')
    .withHistory()
    .withSkipPreviewFetch()
    .onChange(setDraft)
    .onEnter(() => {
      send();
      return true;
    });

  return (
    <div onPointerDown={props.onInteract} onFocusIn={props.onInteract}>
      <ComposerSurface
        as="div"
        class="homepage-task-input"
        data-sent={props.created}
      >
        <ChatInput rows={2} class="gap-3 p-4">
          <ChatInput.Editor>
            <MarkdownShell
              config={config}
              initialValue={props.initialDraft}
              onConnect={() =>
                props.onReady({
                  reset: (text) => config.controls.setMarkdown(text),
                })
              }
              class="h-auto min-h-12 text-base leading-6 [&_[data-markdown-editable]]:outline-none [&_[data-markdown-editable]>.md-p]:my-0 [&_[data-markdown-placeholder]>p]:m-0"
              refFn={(element) => {
                element.setAttribute('role', 'textbox');
                element.setAttribute('aria-multiline', 'true');
                element.setAttribute(
                  'aria-label',
                  'Write a task or message in the demo'
                );
              }}
              placeholder={asTask() ? 'Describe a task…' : 'Message the team…'}
              portalScope="local"
            />
          </ChatInput.Editor>
          <ChatInput.LeftActions class="min-w-0 flex-wrap text-xs text-ink-muted">
            <Button
              size="sm"
              variant="ghost"
              class="gap-1.5 rounded-full text-xs"
              aria-pressed={asTask()}
              onClick={() => setAsTask((value) => !value)}
            >
              <EntityIcon targetType="task" size="xs" /> Send as task
            </Button>
            <Show when={asTask()}>
              <span class="text-ink-muted">Teo · Thursday</span>
            </Show>
            <HomepageMention
              kind="md"
              label="Q3 launch plan"
              description="The plan and owners for Thursday’s launch."
              href="#documents"
            />
          </ChatInput.LeftActions>
          <ChatInput.RightActions>
            <SendButton
              appearance="composer"
              aria-label={asTask() ? 'Create demo task' : 'Send demo message'}
              disabled={!draft().trim()}
              onClick={send}
            />
          </ChatInput.RightActions>
        </ChatInput>
      </ComposerSurface>
    </div>
  );
}
