import { buildConfig } from '@core/component/LexicalMarkdown/builder/MarkdownConfigBuilder';
import { MarkdownShell } from '@core/component/LexicalMarkdown/builder/MarkdownShell';
import { sandboxToCommandItems, SANDBOX_USERS } from '../sandbox/sandbox-store';
import { createSignal } from 'solid-js';
import { HotkeyCallout } from '../components-lib';
import { MockAppChrome } from '../components/MockAppChrome';
import type { LessonContentProps, LessonDefinition } from '../types';

function MarkdownMentionsContent(_props: LessonContentProps) {
  return (
    <div class="flex flex-col gap-3 onboarding-stagger">
      <HotkeyCallout keys={['@']} label="to mention someone" />
      <p>
        Macro's editor supports rich markdown, mentions, and emoji. Try typing
        something or mentioning a teammate with <strong>@</strong>.
      </p>
    </div>
  );
}

function MarkdownMentionsDemo(props: LessonContentProps) {
  const [mentioned, setMentioned] = createSignal(false);

  const sandboxEntities = () =>
    sandboxToCommandItems().map((item) => ({
      ...item,
      kind: 'entity' as const,
    }));

  const config = buildConfig('markdown')
    .namespace('onboarding-editor')
    .withMentions({
      entities: sandboxEntities,
      users: () => SANDBOX_USERS,
      disableMentionTracking: true,
      onCreate: () => {
        if (!mentioned()) {
          setMentioned(true);
          props.onComplete();
        }
      },
    })
    .withEmojis()
    .withHistory()
    .withSkipPreviewFetch();

  return (
    <MockAppChrome viewTitle="Daily Note">
      <div class="px-8 py-6">
        <h1 class="text-3xl font-semibold text-ink mb-4">Daily Note</h1>
        <MarkdownShell
          config={config}
          placeholder="Start typing... use @ to mention"
          autofocus
        />
      </div>
    </MockAppChrome>
  );
}

export const markdownMentionsLesson: LessonDefinition = {
  id: 'markdown-mentions',
  title: 'Editor',
  subtitle: 'Rich text with mentions and emoji.',
  content: MarkdownMentionsContent,
  demo: MarkdownMentionsDemo,
  order: 50,
  skippable: true,
};
