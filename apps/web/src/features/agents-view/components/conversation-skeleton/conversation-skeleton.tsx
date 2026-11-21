import { ListSkeleton } from '@app/components/view-shell/ListSkeleton';
import { t } from '@app/lib/i18n';
import { For } from 'solid-js';

export function ConversationSkeleton(props: { rows?: number }) {
  return (
    <ListSkeleton.Root
      label={t('agentWork.loadingConversations')}
      class="shrink-0"
    >
      <For each={Array.from({ length: props.rows ?? 6 })}>
        {() => (
          <ListSkeleton.Row>
            <span class="flex size-(--sidebar-icon-slot) items-center justify-center">
              <ListSkeleton.Bar class="size-2" />
            </span>
            <ListSkeleton.Bar class="h-2.5 w-2/3" />
          </ListSkeleton.Row>
        )}
      </For>
    </ListSkeleton.Root>
  );
}
