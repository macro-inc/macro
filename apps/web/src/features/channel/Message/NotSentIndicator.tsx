import { t } from '@app/lib/i18n';
import { isChannelPostNotSent } from '@queries/messages/graphql/unsent-posts';
import { cn } from '@ui';
import { Show } from 'solid-js';
import { useMessage } from './context';

/**
 * The class that dims a part of the row while its post waits in the queue,
 * leaving the row's actions as they are.
 */
export function useNotSentDim(): () => string | undefined {
  const message = useMessage();
  return () => (isChannelPostNotSent(message().id) ? 'opacity-60' : undefined);
}

/** Says a post the queue has held for a while is not sent yet. */
export function NotSentIndicator(props: { class?: string }) {
  const message = useMessage();

  return (
    <Show when={isChannelPostNotSent(message().id)}>
      <span
        class={cn('text-xs text-ink-muted', props.class)}
        data-message-not-sent
      >
        {t('channelMessages.notSentYet')}
      </span>
    </Show>
  );
}
