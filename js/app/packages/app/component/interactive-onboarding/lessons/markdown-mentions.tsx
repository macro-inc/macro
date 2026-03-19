import { buildConfig } from '@core/component/LexicalMarkdown/builder/MarkdownConfigBuilder';
import { MarkdownShell } from '@core/component/LexicalMarkdown/builder/MarkdownShell';
import { createSignal } from 'solid-js';
import { HotkeyCallout } from '../components-lib';
import type { LessonContentProps, LessonDefinition } from '../types';

function MarkdownMentionsContent(_props: LessonContentProps) {
  return (
    <div class="flex flex-col gap-3">
      <HotkeyCallout keys={['Enter']} label="to focus the editor" />
      <HotkeyCallout keys={['@']} label="to mention someone" />
      <p
        class="text-sm text-ink/70"
        style={{ animation: 'onboarding-fade-up 300ms ease-out 50ms both' }}
      >
        Macro's editor supports rich markdown, mentions, and emoji. Try typing
        something or mentioning a teammate with <strong>@</strong>.
      </p>
    </div>
  );
}

function MarkdownMentionsDemo(props: LessonContentProps) {
  const [hasTyped, setHasTyped] = createSignal(false);

  const config = buildConfig('markdown')
    .namespace('onboarding-editor')
    .withMentions()
    .withEmojis()
    .withHistory()
    .onChange(() => {
      if (!hasTyped()) {
        setHasTyped(true);
        props.onComplete();
      }
    });

  return (
    <div class="h-full w-full flex items-start justify-center pt-8 px-6">
      <div class="w-full max-w-lg rounded-sm border border-edge-muted bg-panel p-4 min-h-[200px]">
        <MarkdownShell
          config={config}
          placeholder="Start typing... use @ to mention"
          autofocus
        />
      </div>
    </div>
  );
}

export const markdownMentionsLesson: LessonDefinition = {
  id: 'markdown-mentions',
  title: 'Editor',
  subtitle: 'Rich text with mentions and emoji.',
  content: MarkdownMentionsContent,
  demo: MarkdownMentionsDemo,
  order: 50,
};
