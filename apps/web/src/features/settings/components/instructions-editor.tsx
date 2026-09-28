import { buildConfig } from '@core/component/LexicalMarkdown/builder/MarkdownConfigBuilder';
import { MarkdownShell } from '@core/component/LexicalMarkdown/builder/MarkdownShell';
import { createEffect, on, untrack } from 'solid-js';

/** The app's Markdown editor, with string persistence owned by the agent draft. */
export function AgentInstructionsEditor(props: {
  markdown: string;
  onChange: (markdown: string) => void;
  disabled?: boolean;
  placeholder?: string;
  class?: string;
}) {
  const initialMarkdown = untrack(() => props.markdown);
  let connected = false;
  let applyingMarkdown = false;
  let appliedMarkdown = initialMarkdown;
  let renderedMarkdown = '';
  let editable: HTMLDivElement | undefined;
  const config = buildConfig('markdown')
    .namespace('agent-instructions')
    .withHistory()
    .withCode()
    .withMentions({ showOpenTabs: true, disableMentionTracking: true })
    .withEmojis()
    .withLinks({ floatingMenu: true })
    .withFloatingFormatMenu()
    .onChange((markdown) => {
      if (!connected || applyingMarkdown || markdown === renderedMarkdown)
        return;
      renderedMarkdown = markdown;
      // Use the shared editor's Markdown format so mention identities and
      // other rich content survive saving and reopening the instructions.
      appliedMarkdown = markdown;
      props.onChange(appliedMarkdown);
    });

  const applyMarkdown = (markdown: string) => {
    if (!connected || markdown === appliedMarkdown) return;
    appliedMarkdown = markdown;
    applyingMarkdown = true;
    try {
      config.controls.setMarkdown(markdown);
      renderedMarkdown = config.controls.getMarkdown();
    } finally {
      applyingMarkdown = false;
    }
  };
  createEffect(on(() => props.markdown, applyMarkdown));
  createEffect(
    on(
      () => !!props.disabled,
      (disabled) => editable?.setAttribute('aria-disabled', String(disabled))
    )
  );

  return (
    <div class={`portal-scope relative ${props.class ?? ''}`}>
      <MarkdownShell
        config={config}
        initialValue={initialMarkdown}
        disabled={props.disabled}
        placeholder={props.placeholder}
        portalScope="local"
        class="min-h-40 text-sm leading-6 [&_[data-markdown-editable]]:min-h-full [&_[data-markdown-editable]]:outline-none"
        refFn={(element) => {
          editable = element;
          element.setAttribute('role', 'textbox');
          element.setAttribute('aria-label', 'Instructions');
          element.setAttribute('aria-multiline', 'true');
          element.setAttribute('aria-disabled', String(!!props.disabled));
        }}
        onConnect={() => {
          // Importing Markdown can normalize whitespace or list markers. Keep
          // the saved string untouched until the person actually edits it.
          // Empty initialization is deferred, so flush it before recording the
          // baseline; otherwise its first paragraph looks like a user edit.
          config.controls.getLexical().read(() => {});
          renderedMarkdown = config.controls.getMarkdown();
          connected = true;
          applyMarkdown(untrack(() => props.markdown));
        }}
      />
    </div>
  );
}
