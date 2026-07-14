import { EditorConfigBuilder } from '@core/component/LexicalMarkdown/builder/MarkdownConfigBuilder';
import { MarkdownShell } from '@core/component/LexicalMarkdown/builder/MarkdownShell';

export function AutomationPromptEditor(props: {
  initialValue: string;
  onChange: (markdown: string) => void;
}) {
  const editor = new EditorConfigBuilder()
    .namespace('automation-prompt')
    .withHistory()
    .withLinks()
    .withMentions()
    .onChange(props.onChange);

  return (
    <div class="min-h-45 border border-edge-muted rounded-sm bg-surface **:[[contenteditable]]:px-2 **:[[contenteditable]]:py-1.5 **:[[contenteditable]]:text-sm **:[[contenteditable]]:outline-none cursor-default">
      <MarkdownShell
        config={editor}
        initialValue={props.initialValue}
        placeholder=""
        portalScope="local"
        class="min-h-45"
      />
    </div>
  );
}
