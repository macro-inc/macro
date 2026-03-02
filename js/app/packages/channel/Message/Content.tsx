import { Show } from 'solid-js';

import { channelTheme } from '@core/component/LexicalMarkdown/theme';
import { cn } from '@ui/utils/classname';
import { useMessage } from './context';
import { StaticMarkdown } from '@core/component/LexicalMarkdown/component/core/StaticMarkdown';

type ContentProps = {
  class?: string;
};

export function Content(props: ContentProps) {
  const message = useMessage();

  return (
    <Show when={message().content}>
      <div class={cn('text-sm whitespace-pre-wrap break-words', props.class)}>
        <StaticMarkdown
          markdown={message().content ?? ''}
          theme={channelTheme}
          target="internal"
        />
      </div>
    </Show>
  );
}
