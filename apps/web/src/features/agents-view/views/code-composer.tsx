import { buildConfig } from '@core/component/LexicalMarkdown/builder/MarkdownConfigBuilder';
import { MarkdownShell } from '@core/component/LexicalMarkdown/builder/MarkdownShell';
import { ComposerSurface, SendButton } from '@ui';
import type { JSX } from 'solid-js';

/** Code keeps a roomy task editor with model and repository controls below. */
export function CodeComposer(props: {
  draft: string;
  onDraftChange: (draft: string) => void;
  placeholder: string;
  blockedReason?: string;
  modelSelector: JSX.Element;
  repositorySelector: JSX.Element;
  onSend: (prompt: string) => void;
}) {
  const editor = buildConfig('chat')
    .namespace('agents-code-composer')
    .withMentions({ showOpenTabs: true, block: 'agent' })
    .withEmojis()
    .withLinks({ floatingMenu: true, autoLinkMatchMode: 'common-tlds' })
    .withHistory({ timeGap: 400 })
    .withCode()
    .withRestoreFocus()
    .withSkills()
    .onEnter((_event, markdown) => {
      send(markdown);
      return true;
    })
    .onChange(props.onDraftChange);

  const send = (markdown = editor.controls.getMarkdown()) => {
    const prompt = markdown.trim();
    if (!prompt || props.blockedReason) return;
    editor.controls.clear();
    props.onDraftChange('');
    props.onSend(prompt);
  };

  return (
    <ComposerSurface
      as="div"
      data-agent-composer="code"
      class="flex min-w-0 flex-col"
    >
      <div class="min-h-[104px] px-5 pt-5 pb-2 text-base text-composer-ink">
        <MarkdownShell
          class="h-auto min-h-[60px] max-h-80 [&_[data-markdown-editable]]:min-h-[60px] [&_[data-markdown-editable]]:outline-none"
          config={editor}
          initialValue={props.draft}
          placeholder={props.placeholder}
          refFn={(element) =>
            element.setAttribute('aria-label', 'Task for the coder')
          }
          autofocus
        />
      </div>
      <div class="flex flex-wrap items-center gap-1.5 px-3 pt-1 pb-3">
        {props.modelSelector}
        {props.repositorySelector}
        <div class="flex-1" />
        <SendButton
          appearance="composer"
          aria-label="Send"
          title={props.blockedReason}
          disabled={!props.draft.trim() || !!props.blockedReason}
          onClick={() => send()}
        />
      </div>
    </ComposerSurface>
  );
}
