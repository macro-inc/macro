import { ListSkeleton } from '@app/components/view-shell/ListSkeleton';
import { t } from '@app/lib/i18n';
import { Topbar } from './Topbar';

/** A conversation until its first load resolves, laid out like its pane. */
export function AgentSessionSkeleton() {
  return (
    <>
      <Topbar titleContent={<ListSkeleton.Bar class="h-3 w-40" />} />
      <ListSkeleton.Root
        label={t('common.loadingConversation')}
        class="relative min-h-0 min-w-0 flex-1"
      >
        <div class="pane absolute inset-0 flex flex-col">
          <div class="macro-message-width mx-auto flex min-h-0 w-full flex-1 flex-col gap-3 overflow-hidden px-4 pt-4">
            <ListSkeleton.Bar class="mb-3 h-9 w-2/5 self-end" />
            <ListSkeleton.Bar class="w-4/5" />
            <ListSkeleton.Bar class="w-full" />
            <ListSkeleton.Bar class="mb-3 w-3/5" />
            <ListSkeleton.Bar class="mb-3 h-9 w-1/3 self-end" />
            <ListSkeleton.Bar class="w-11/12" />
            <ListSkeleton.Bar class="w-2/3" />
          </div>
          <div class="dock">
            <div class="composer-anchor">
              <ListSkeleton.Bar class="h-12 w-full" />
            </div>
          </div>
        </div>
      </ListSkeleton.Root>
    </>
  );
}
