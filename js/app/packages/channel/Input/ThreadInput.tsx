import type { ComponentProps } from 'solid-js';
import { ChannelInput } from './ChannelInput';

type ThreadInputProps = ComponentProps<typeof ChannelInput>;

export function ThreadInput(props: ThreadInputProps) {
  return (
    <ChannelInput
      {...props}
      input={{
        ...props.input,
        mode: 'reply',
      }}
      markdownNamespace={props.markdownNamespace ?? 'thread-input-markdown'}
    />
  );
}
