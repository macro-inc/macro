import { ViewSidebar } from '@app/components/view-shell';
import { t } from '@app/lib/i18n';
import FlowArrowIcon from '@icon/system/regular/tree-structure.svg';
import { Show } from 'solid-js';
import { useSequences } from '../context/sequences-context';
import { needsAttentionTotal } from '../core/sequence';

/** The Customers sidebar entry, with how many enrollments need the owner. */
export function SequencesNavView(props: {
  active: boolean;
  onSelect: () => void;
}) {
  const list = useSequences().createSequenceList();
  return (
    <ViewSidebar.Nav aria-label={t('sequences.navigation')}>
      <ViewSidebar.Item active={props.active} onClick={() => props.onSelect()}>
        <ViewSidebar.Icon>
          <FlowArrowIcon class="size-4" />
        </ViewSidebar.Icon>
        <span class="min-w-0 flex-1 truncate">{t('sequences.title')}</span>
        <Show when={needsAttentionTotal(list.sequences())}>
          {(count) => (
            <span class="text-xs tabular-nums text-failure">
              <span aria-hidden="true">{count()}</span>
              <span class="sr-only">
                {t('sequences.needAttentionCount', { count: count() })}
              </span>
            </span>
          )}
        </Show>
      </ViewSidebar.Item>
    </ViewSidebar.Nav>
  );
}
