import type { SystemSortOption } from '@app/features/next-soup/soup-view/sort-options';
import { useSoupView } from '@app/features/next-soup/soup-view/soup-view-context';
import { useCrmDisplayOptions } from '@companies/crm/display-options';
import { useListLayout } from '@entity/composed/list-entity/shared';
import ArrowDownIcon from '@phosphor/arrow-down.svg';
import { cn } from '@ui/utils/classname';
import { createMemo, For, Show } from 'solid-js';
import '../tasks/list-property-value.css';
import {
  COMPANY_GRID_COLUMNS,
  companyGridTemplateAreas,
  companyGridTemplateColumns,
} from './company-grid-template';

/**
 * Responsive wrapper that only shows the header when layout is wide.
 * Must be used inside a ListLayoutProvider.
 */
export function ResponsiveCompanyListHeader(props: { class?: string }) {
  const layout = useListLayout();
  const isWide = () => layout?.isWide() ?? true;

  return (
    <Show when={isWide()}>
      <CompanyListHeader class={props.class} />
    </Show>
  );
}

/**
 * Sticky table header mirroring the column template of CompanyGridLayout
 * so the column labels line up with the property values in each row.
 * The trailing Last Interaction column is clickable to sort (backed by
 * `updated_at`, which carries `crm_companies.last_interaction`).
 */
function CompanyListHeader(props: { class?: string }) {
  const { soup } = useSoupView();
  const displayOptions = useCrmDisplayOptions();

  // Mirror the row grid: hidden display-option columns collapse here too so
  // the header tracks stay aligned with CompanyGridLayout.
  const visibleColumns = createMemo(() =>
    COMPANY_GRID_COLUMNS.filter(
      (col) => displayOptions.options().listColumns[col.id]
    )
  );
  const activeSort = createMemo(() => soup.sort.active()[0]);
  const setSort = (id: SystemSortOption) => {
    if (activeSort()?.id === id) {
      soup.sort.flip(id);
    } else {
      soup.sort.setAll([id]);
    }
  };

  return (
    <div
      // px-3 (12px) matches each row's total horizontal inset — the row's
      // Entity.Root `mx-1` (4px) plus Entity.Layout `px-2` (8px) — so the
      // header grid tracks line up exactly with the row grid tracks.
      class={cn(
        'company-grid-row w-full grid items-center gap-2 px-3 h-10',
        'text-xs font-medium text-ink-extra-muted',
        'bg-surface',
        props.class
      )}
      style={{
        'grid-template-columns': companyGridTemplateColumns(
          visibleColumns(),
          false
        ),
        'grid-template-areas': companyGridTemplateAreas(
          visibleColumns(),
          false
        ),
      }}
    >
      <div style={{ 'grid-area': 'indicator' }} />
      <div style={{ 'grid-area': 'content' }} class="truncate">
        Customer
      </div>
      <For each={visibleColumns()}>
        {(col) => (
          <div
            style={{ 'grid-area': col.id }}
            class="flex items-center min-w-0 @min-[841px]/u-list:pl-2"
          >
            <span class="truncate @max-[840px]/u-list:hidden">{col.label}</span>
          </div>
        )}
      </For>
      <div
        style={{ 'grid-area': 'timestamp' }}
        class="flex items-center min-w-0"
      >
        <button
          type="button"
          onClick={() => setSort('updated_at')}
          class={cn(
            'flex items-center gap-1 min-w-0 w-full h-full justify-end',
            'hover:text-ink transition-colors',
            activeSort()?.id === 'updated_at' && 'text-ink'
          )}
        >
          <span class="truncate">Last Interaction</span>
          <ArrowDownIcon
            class={cn(
              'size-3 shrink-0 transition-transform',
              activeSort()?.id === 'updated_at'
                ? 'text-ink'
                : 'text-ink-extra-muted',
              activeSort()?.id === 'updated_at' &&
                activeSort()?.reversed &&
                'rotate-180'
            )}
          />
        </button>
      </div>
    </div>
  );
}
