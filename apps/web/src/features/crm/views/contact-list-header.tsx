import { useListLayout } from '@entity/composed/list-entity/shared';
import ArrowDownIcon from '@phosphor/arrow-down.svg';
import { cn } from '@ui/utils/classname';
import { Show } from 'solid-js';
import { contactGridTemplate } from '../components/contact-grid-template';
import { useCrmWorkspace } from '../context/workspace-context';

/**
 * Sticky People header aligned with the contact row tracks. Must be used
 * inside a ListLayoutProvider; only the wide layout has columns.
 */
export function ResponsiveContactListHeader(props: { class?: string }) {
  const layout = useListLayout();
  const { soup } = useCrmWorkspace();
  const sortedByInteraction = () => soup.sort.active()[0]?.id === 'updated_at';
  const sortByInteraction = () =>
    sortedByInteraction()
      ? soup.sort.flip('updated_at')
      : soup.sort.setAll(['updated_at']);
  return (
    <Show when={layout?.isWide() ?? true}>
      <div
        // px-3 matches the row's Entity.Root `mx-1` plus Entity.Layout `px-2`.
        class={cn(
          'w-full grid items-center gap-2 px-3 h-10 text-xs font-medium text-ink-extra-muted bg-surface',
          props.class
        )}
        style={contactGridTemplate(false)}
      >
        <div style={{ 'grid-area': 'indicator' }} />
        <div style={{ 'grid-area': 'content' }} class="truncate">
          Person
        </div>
        <div style={{ 'grid-area': 'company' }} class="truncate">
          Company
        </div>
        <div style={{ 'grid-area': 'timestamp' }} class="flex min-w-0">
          <button
            type="button"
            onClick={sortByInteraction}
            title="Most recent email interaction, incoming or outgoing"
            class={cn(
              'flex items-center gap-1 min-w-0 w-full h-full justify-end hover:text-ink transition-colors',
              sortedByInteraction() && 'text-ink'
            )}
          >
            <span class="truncate">Last contacted</span>
            <ArrowDownIcon
              class={cn(
                'size-3 shrink-0 transition-transform',
                sortedByInteraction() ? 'text-ink' : 'text-ink-extra-muted',
                sortedByInteraction() &&
                  soup.sort.active()[0]?.reversed &&
                  'rotate-180'
              )}
            />
          </button>
        </div>
      </div>
    </Show>
  );
}
