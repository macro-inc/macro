import { getViewPreset } from '@app/features/next-soup/sidebar/soup-filter-presets';
import { SearchableMultiSelect } from '@app/features/next-soup/soup-view/filters-bar/searchable-multi-select';
import { useTagOptions } from '@app/features/next-soup/soup-view/filters-bar/tag-filter';
import { SoupView } from '@app/features/next-soup/soup-view/soup-view';
import { useSplitPanelOrThrow } from '@components/app/split-layout/layoutUtils';
import { LoadingBlock } from '@core/component/LoadingBlock';
import { Combobox } from '@kobalte/core/combobox';
import CaretDownIcon from '@phosphor/caret-down.svg';
import TagIcon from '@phosphor/tag.svg';
import { Button, cn } from '@ui';
import { createEffect, createMemo, Show } from 'solid-js';
import { buildTaggedItemsQuery } from './tagNavigation';

export type TagSoupViewParams = {
  tagOptionId?: string;
};

function TagSelector(props: { tagOptionId: string }) {
  const panel = useSplitPanelOrThrow();
  const tags = useTagOptions();
  const selectedOption = createMemo(() =>
    tags.optionsById().get(props.tagOptionId)
  );

  const navigateToTag = (tagOptionId: string) => {
    panel.handle.replace({
      next: {
        type: 'component',
        id: 'tag',
        preserveParams: true,
        params: { tagOptionId },
      },
      referredFrom: null,
    });
  };

  return (
    <SearchableMultiSelect
      options={tags.options}
      activeIds={() => [props.tagOptionId]}
      onChange={(ids) => {
        const nextId = ids.find((id) => id !== props.tagOptionId);
        if (nextId) navigateToTag(nextId);
      }}
      placeholder="Search tags..."
      preserveOrder
      placement="bottom-start"
    >
      <Combobox.Trigger
        as={Button}
        variant="base"
        size="sm"
        depth={2}
        class={cn('bg-surface gap-1 max-w-56')}
      >
        <Show
          when={selectedOption()?.icon}
          fallback={<TagIcon class="size-3.5 shrink-0" />}
        >
          {(icon) => (
            <span class="size-3.5 shrink-0 flex items-center justify-center">
              {icon()()}
            </span>
          )}
        </Show>
        <span class="truncate">{selectedOption()?.label ?? 'Select tag'}</span>
        <CaretDownIcon class="size-3 shrink-0" />
      </Combobox.Trigger>
    </SearchableMultiSelect>
  );
}

export function TagSoupView(props: TagSoupViewParams) {
  const panel = useSplitPanelOrThrow();
  const tags = useTagOptions();

  const params = createMemo(() => {
    const content = panel.handle.content();
    if (content.type === 'component' && content.id === 'tag') {
      return content.params as TagSoupViewParams | undefined;
    }
    return props;
  });
  const selectedId = createMemo(() => params()?.tagOptionId);
  const selectedDefinitionId = createMemo(() => {
    const id = selectedId();
    return id ? tags.defByOption().get(id) : undefined;
  });

  createEffect(() => {
    const id = selectedId();
    const options = tags.options();
    if (id || options.length === 0) return;

    panel.handle.replace({
      next: {
        type: 'component',
        id: 'tag',
        preserveParams: true,
        params: { tagOptionId: options[0].id },
      },
      referredFrom: null,
      mergeHistory: true,
    });
  });

  const selectedTag = createMemo(() => {
    const optionId = selectedId();
    const propertyDefinitionId = selectedDefinitionId();
    if (!optionId || !propertyDefinitionId) return undefined;
    return { optionId, propertyDefinitionId };
  });

  const searchPreset = getViewPreset('search');

  return (
    <Show when={selectedTag()} keyed fallback={<LoadingBlock />}>
      {(tag) => (
        <SoupView
          viewName="Tagged"
          customTabs={<TagSelector tagOptionId={tag.optionId} />}
          filterBarVariant="tag"
          showCreateButton={false}
          initialFilters={buildTaggedItemsQuery(tag)}
          initialClientFilters={searchPreset?.clientFilters}
        />
      )}
    </Show>
  );
}
