import { StaticMarkdown } from '@core/component/LexicalMarkdown/component/core/StaticMarkdown';

import { channelTheme } from '@core/component/LexicalMarkdown/theme';
import { isEmojiOnly } from '@core/util/string';
import { cn } from '@ui';
import { createMemo, Show } from 'solid-js';
import { useMessage } from './context';

type ContentProps = {
  class?: string;
};

export function Content(props: ContentProps) {
  const message = useMessage();
  const bigEmoji = createMemo(() => isEmojiOnly(message().content ?? ''));

  return (
    <Show when={message().content}>
      <div
        class={cn(
          'whitespace-pre-wrap wrap-break-word max-w-full',
          bigEmoji() ? 'text-4xl' : 'text-sm',
          props.class
        )}
      >
        <StaticMarkdown
          markdown={message().content ?? ''}
          theme={channelTheme}
          target="internal"
        />
      </div>
    </Show>
  );
}
