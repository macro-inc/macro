import {
  ListFilterDropdown,
  type ListFilterGroup,
} from '@app/components/view-shell';
import { addUnique, removeValue } from '@app/lib/signals/store-array-updaters';
import { PreviewButton } from '@components/app/split-layout/components/PreviewButton';
import { EntityIcon } from '@core/component/EntityIcon';
import { createMemo, Show } from 'solid-js';
import { useEmailView } from '../email-view-context';
import { EMAIL_FILTER_GROUPS } from '../filters/email-facets';
import type { EmailFilterGroupId, EmailFilterOptionId } from '../types';

const FILTER_GROUPS: ListFilterGroup<
  EmailFilterGroupId,
  EmailFilterOptionId
>[] = EMAIL_FILTER_GROUPS.map((group) => ({
  ...group,
  options: group.options.map((option) => ({
    ...option,
    icon: option.iconType
      ? () => <EntityIcon targetType={option.iconType} size="xs" />
      : undefined,
  })),
}));

const groupFor = (groupId: EmailFilterGroupId) =>
  FILTER_GROUPS.find((group) => group.id === groupId);

export type EmailControlsProps = {
  /** Controlled filter-menu state, so the header's `f` hotkey can open it. */
  filterOpen?: boolean;
  onFilterOpenChange?: (open: boolean) => void;
};

export function EmailControls(props: EmailControlsProps) {
  const { state, setFacets, setPreviewOpen } = useEmailView();

  const activeFilterCount = createMemo(() =>
    Object.values(state.facets).reduce(
      (count, optionIds) => count + optionIds.length,
      0
    )
  );

  // Single-select groups carry an "All" option that stands for no selection.
  const isSelected = (
    groupId: EmailFilterGroupId,
    optionId: EmailFilterOptionId
  ) => {
    const selected = state.facets[groupId] ?? [];
    const group = groupFor(groupId);
    if (
      group?.selectionMode === 'single' &&
      optionId === group.defaultOptionId
    ) {
      return selected.length === 0;
    }

    return selected.includes(optionId);
  };

  const setSelected = (
    groupId: EmailFilterGroupId,
    optionId: EmailFilterOptionId,
    selected: boolean
  ) => {
    const group = groupFor(groupId);
    if (group?.selectionMode === 'single') {
      if (!selected) return;

      setFacets({
        ...state.facets,
        [groupId]: optionId === group.defaultOptionId ? [] : [optionId],
      });
      return;
    }

    // Persisted facets preserve unknown IDs; menu actions only accept known IDs.
    const update = selected
      ? addUnique<string>(optionId)
      : removeValue<string>(optionId);
    setFacets({
      ...state.facets,
      [groupId]: update(state.facets[groupId]),
    });
  };

  return (
    <div class="flex min-w-0 shrink-0 items-center justify-end gap-2 @max-[720px]/view-shell:gap-1">
      <div class="relative shrink-0">
        <ListFilterDropdown
          label="Filter email"
          open={props.filterOpen}
          onOpenChange={props.onFilterOpenChange}
          groups={FILTER_GROUPS}
          isSelected={isSelected}
          onSelectionChange={setSelected}
          onClear={() => setFacets({})}
        />
        <Show when={activeFilterCount() > 0}>
          <span class="absolute -top-0.5 right-0 flex size-4 translate-x-1/2 items-center justify-center rounded-full bg-accent text-xxs font-medium leading-none text-surface">
            {activeFilterCount()}
          </span>
        </Show>
      </div>
      <PreviewButton
        iconOnly
        class="rounded-lg"
        onOpenChange={setPreviewOpen}
      />
    </div>
  );
}
