import { CommandMenuInner, CommandState } from '@app/component/command';
import { sandboxToCommandItems } from '../sandbox/sandbox-store';
import { createEffect, createSignal, on, onCleanup, onMount } from 'solid-js';
import { HotkeyCallout } from '../components-lib';
import type { LessonContentProps, LessonDefinition } from '../types';

function CommandKContent(props: LessonContentProps) {
  const [completed, setCompleted] = createSignal(false);

  // Complete after the user navigates the list (selectedIndex changes)
  createEffect(
    on(CommandState.selectedIndex, (idx) => {
      if (!completed() && idx > 0) {
        setCompleted(true);
        props.onComplete();
      }
    })
  );

  return (
    <div class="flex flex-col gap-3">
      <HotkeyCallout keys={['⌘', 'K']} label="to open the command menu" />
      <p
        class="text-sm text-ink/70"
        style={{ animation: 'onboarding-fade-up 300ms ease-out 50ms both' }}
      >
        Search for anything — documents, emails, tasks, channels — and navigate
        to it instantly.
      </p>
      <p
        class="text-sm text-ink/70"
        style={{ animation: 'onboarding-fade-up 300ms ease-out 150ms both' }}
      >
        Try searching and selecting an item.
      </p>
    </div>
  );
}

function CommandKDemo(_props: LessonContentProps) {
  let commandMenuRef: HTMLDivElement | undefined;

  onMount(() => {
    CommandState.forceReset();
  });

  onCleanup(() => {
    CommandState.forceReset();
  });

  const items = () => sandboxToCommandItems();

  return (
    <div
      ref={commandMenuRef}
      class="h-full w-full flex items-start justify-center pt-4 px-4"
    >
      <div class="w-full max-w-lg">
        <CommandMenuInner commandMenuRef={() => commandMenuRef} items={items} />
      </div>
    </div>
  );
}

export const commandKLesson: LessonDefinition = {
  id: 'command-k',
  title: 'Command K',
  subtitle: 'Your universal search and action bar.',
  content: CommandKContent,
  demo: CommandKDemo,
  order: 40,
};
