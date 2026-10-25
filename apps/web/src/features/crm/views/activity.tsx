import { fireAndForget } from '@core/util/fireAndForget';
import PlusIcon from '@phosphor/plus.svg';
import { Button } from '@ui';
import { createSignal, Show } from 'solid-js';
import { useCrmContext } from '../context/crm-context';
import type { CrmActivityTab } from '../core/navigation';
import { RecordItemList } from './record-item-list';

const DESCRIPTIONS: Record<CrmActivityTab, string> = {
  tasks: 'Tasks linked to your CRM companies and people.',
  email: 'Email in your mailbox exchanged with your CRM companies and people.',
  notes: 'Notes linked to your CRM companies and people.',
  calls: 'Calls linked to your CRM companies and people.',
};

/** The workspace-wide feed uses the same paged rows as a record's activity. */
export function CrmActivityView(props: { tab: CrmActivityTab }) {
  const crm = useCrmContext();
  const source = crm.createActivity(() => props.tab);
  const [retrying, setRetrying] = createSignal(false);
  const retry = async () => {
    if (!source.refetch || retrying()) return;
    setRetrying(true);
    try {
      await source.refetch();
    } catch {
      // Keep the source's error state and retry action visible.
    } finally {
      setRetrying(false);
    }
  };
  return (
    <div class="flex min-h-0 flex-1 flex-col">
      <div class="flex items-center justify-between gap-3 border-b border-edge-muted px-4 py-3">
        <p class="text-sm text-ink-muted">{DESCRIPTIONS[props.tab]}</p>
        <Show when={props.tab === 'tasks'}>
          <Button
            variant="outline"
            class="shrink-0"
            onClick={crm.openTaskComposer}
          >
            <PlusIcon class="size-4" />
            New task
          </Button>
        </Show>
      </div>
      <div class="min-h-0 flex-1 overflow-y-auto p-4">
        <Show
          when={!source.isError}
          fallback={
            <div class="flex flex-col items-start gap-3 text-sm text-ink-muted">
              <p>Could not load CRM {props.tab}.</p>
              <Button
                variant="outline"
                disabled={retrying()}
                onClick={() => fireAndForget(retry(), 'crm')}
              >
                {retrying() ? 'Retrying…' : 'Try again'}
              </Button>
            </div>
          }
        >
          <RecordItemList
            source={source}
            empty={`No ${props.tab} linked to your CRM companies or people yet.`}
          />
        </Show>
      </div>
    </div>
  );
}
