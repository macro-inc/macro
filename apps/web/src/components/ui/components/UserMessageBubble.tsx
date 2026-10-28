import { liveThemeMode } from '@app/features/theme/signals/themeSignals';
import { type JSX, Show } from 'solid-js';
import { InvertUtil } from './InvertUtil';
import { Layer } from './Layer';

/** Shared user prompt bubble for the production chat and agent transcripts. */
export function UserMessageBubble(props: { children: JSX.Element }) {
  const bubble = () => (
    <div
      data-user-message-bubble
      class="relative ml-auto w-fit min-w-0 max-w-[85%] rounded-3xl bg-surface text-ink px-4 py-2.5 whitespace-pre-wrap wrap-break-word [&_.md>:first-child]:mt-0! [&_.md>:last-child]:mb-0!"
    >
      {props.children}
    </div>
  );

  return (
    <Show
      when={liveThemeMode() === 'light'}
      fallback={<Layer depth={3}>{bubble()}</Layer>}
    >
      <InvertUtil>{bubble()}</InvertUtil>
    </Show>
  );
}
