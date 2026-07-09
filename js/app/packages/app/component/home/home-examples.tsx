import { useChatInputContext } from '@core/component/AI/context';
import { isMobile } from '@core/mobile/isMobile';
import { AnimatedEmailIcon } from '@icon/wide-email';
import { AnimatedFileMdIcon } from '@icon/wide-fileMd';
import { AnimatedSearchIcon } from '@icon/wide-search';
import XIcon from '@phosphor/x.svg';
import { createSignal, For, type JSX, Show } from 'solid-js';
import { Dynamic } from 'solid-js/web';
import { replaceHomeComposerSelection } from './home-composer-selection';
import type { HomePreferences } from './home-prefs';

type HomeExample = {
  icon: (props: { class?: string; triggerAnimation?: boolean }) => JSX.Element;
  title: string;
  description: string;
  prompt: string;
};

const HOME_EXAMPLES: HomeExample[] = [
  {
    icon: AnimatedFileMdIcon,
    title: 'Draft a document',
    description: 'Start from an idea',
    prompt: 'Help me draft a document about ',
  },
  {
    icon: AnimatedEmailIcon,
    title: 'Draft an email',
    description: 'Reply or compose',
    prompt: 'Help me draft an email to ',
  },
  {
    icon: AnimatedSearchIcon,
    title: 'Search & research',
    description: 'Across your workspace',
    prompt: 'Research and summarize everything we have about ',
  },
];

/**
 * Dismissible example-prompt cards. Clicking one loads the prompt prefix into
 * the home composer. Hidden on mobile.
 */
export function HomeExamples(props: { preferences: HomePreferences }) {
  const input = useChatInputContext();
  const [hovered, setHovered] = createSignal<number | null>(null);

  return (
    <Show when={!isMobile() && !props.preferences.isDismissed('examples')}>
      <section>
        <div class="mb-2 flex items-center justify-between px-1">
          <span class="text-sm text-ink-muted">Examples</span>
          <button
            type="button"
            class="rounded-md p-1 text-ink-extra-muted transition-colors hover:bg-hover hover:text-ink-muted"
            aria-label="Dismiss examples"
            onClick={() => props.preferences.dismiss('examples')}
          >
            <XIcon class="size-3.5" />
          </button>
        </div>
        <div class="grid grid-cols-1 gap-2.5 sm:grid-cols-3">
          <For each={HOME_EXAMPLES}>
            {(example, i) => (
              <button
                type="button"
                class="group flex flex-col gap-1 rounded-xl border border-edge-muted bg-active p-3 text-left transition-colors hover:bg-hover"
                onClick={() =>
                  replaceHomeComposerSelection(input, example.prompt)
                }
                onMouseEnter={() => setHovered(i())}
                onMouseLeave={() =>
                  setHovered((prev) => (prev === i() ? null : prev))
                }
              >
                <div class="flex items-center gap-2">
                  <Dynamic
                    component={example.icon}
                    triggerAnimation={hovered() === i()}
                    class="size-4 shrink-0 text-ink-muted transition-colors group-hover:text-accent"
                  />
                  <span class="text-sm font-medium text-ink">
                    {example.title}
                  </span>
                </div>
                <span class="truncate text-xs text-ink-muted">
                  {example.description}
                </span>
              </button>
            )}
          </For>
        </div>
      </section>
    </Show>
  );
}
