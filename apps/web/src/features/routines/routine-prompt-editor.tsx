import { useMacroMentionLinkResolver } from '@components/app/split-layout/split-router/mention-links';
import { EditorConfigBuilder } from '@core/component/LexicalMarkdown/builder/MarkdownConfigBuilder';
import { MarkdownShell } from '@core/component/LexicalMarkdown/builder/MarkdownShell';

export function RoutinePromptEditor(props: {
  initialValue: string;
  onChange: (markdown: string) => void;
}) {
  const editor = new EditorConfigBuilder()
    .withAppLinkResolver(useMacroMentionLinkResolver())
    .namespace('routine-prompt')
    .withHistory()
    .withLinks()
    .withMentions()
    .onChange(props.onChange);

  return (
    <div class="min-h-28 **:[[contenteditable]]:text-sm **:[[contenteditable]]:outline-none cursor-default">
      <MarkdownShell
        config={editor}
        initialValue={props.initialValue}
        placeholder="What should this routine do? Type @ to add context…"
        portalScope="local"
        class="min-h-28"
      />
    </div>
  );
}
