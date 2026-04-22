import { buildConfig } from '@core/component/LexicalMarkdown/builder/MarkdownConfigBuilder';
import { MarkdownShell } from '@core/component/LexicalMarkdown/builder/MarkdownShell';
import { sandboxToCommandItems, SANDBOX_USERS } from '../sandbox/sandbox-store';
import { createSignal, onCleanup } from 'solid-js';
import { sidebarFilter, setSidebarFilter } from '../sandbox/sandbox-store';
import { HotkeyCallout } from '../components-lib';
import { MockAppChrome } from '../components/MockAppChrome';
import type { LessonContentProps, LessonDefinition } from '../types';

/** Shared completion state between content and demo panels. */
const [completed, setCompleted] = createSignal(false);

function MarkdownMentionsContent(_props: LessonContentProps) {
  return (
    <div class="flex flex-col gap-3 onboarding-stagger">
      <HotkeyCallout
        keys={['@']}
        label="to mention someone or something"
        completed={completed()}
      />
      <p>
        Macro's editor supports rich markdown, mentions, and emoji. Try
        mentioning someone or something by typing <strong>@</strong> in the
        editor.
      </p>
    </div>
  );
}

function MarkdownMentionsDemo(props: LessonContentProps) {
  const [mentioned, setMentioned] = createSignal(false);

  const previousFilter = sidebarFilter();
  setSidebarFilter(null);

  onCleanup(() => {
    setCompleted(false);
    setSidebarFilter(previousFilter);
  });

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
          setCompleted(true);
          props.onComplete();
        }
      },
    })
    .withEmojis()
    .withHistory()
    .withSkipPreviewFetch();

  return (
    <MockAppChrome>
      <div class="h-full flex flex-col px-8 py-6">
        <h1 class="text-3xl font-semibold text-ink mb-4">Daily Note</h1>
        <MarkdownShell
          class="flex-1 min-h-0 cursor-text"
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
  content: MarkdownMentionsContent,
  demo: MarkdownMentionsDemo,
  order: 50,
};
