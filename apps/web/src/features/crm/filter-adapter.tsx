import { makeFlaggedPersisted } from '@app/preferences/make-flagged-persisted';
import { useEntryState } from '@components/app/split-layout/entry-state';
import { UserIcon } from '@core/component/UserIcon';
import {
  useContactFilterLabels,
  useContactFilterOptionsWithEmpty,
} from '@core/user/use-contact-filter-options';
import { idToDisplayName } from '@core/user/util';
import CircleDashedIcon from '@icon/system/regular/circle-dashed.svg';
import { createLazyMemo } from '@solid-primitives/memo';
import { type Accessor, createEffect, type JSX } from 'solid-js';
import type { SoupState } from '../next-soup/create-soup-state';
import { NO_ASSIGNEE, NO_STAGE } from '../next-soup/filters/configs';
import type { CollectionSelectFilter } from '../next-soup/soup-view/collection-select-filter';
import type { SearchableOptionSourceFactory } from '../next-soup/soup-view/filters-bar/option-source';
import type { SearchableOption } from '../next-soup/soup-view/filters-bar/searchable-multi-select';
import { buildContactLabel } from '../next-soup/soup-view/filters-bar/unified-filter-dropdown';
import { CrmStageIcon } from './components/stage-icon';
import type { CrmContext } from './context/crm-context';
import type { DealStages } from './context/crm-sources';
import { createCrmFilterSelections } from './primitives/filter-selections';

function noOwnerOption(): SearchableOption {
  return {
    id: NO_ASSIGNEE,
    label: 'No owner',
    icon: () => <CircleDashedIcon class="size-3.5 text-ink-muted" />,
  };
}
const useOwnerOptions: SearchableOptionSourceFactory = (selected, enabled) =>
  useContactFilterOptionsWithEmpty(selected, enabled, noOwnerOption);

export function createCrmCollectionFilters(
  crm: Pick<CrmContext, 'userId' | 'createTeamSource'>,
  soup: Pick<SoupState, 'predicates'>,
  persist: Accessor<boolean>,
  dealStages: Pick<DealStages, 'filterStages' | 'stages'>
) {
  const [ownerFilter, setOwnerFilter] = makeFlaggedPersisted(
    useEntryState<string[]>('soup.ownerFilter', { default: [] }),
    { enabled: persist, name: 'soup-view-owner-filter-v2' }
  );
  const [stageFilter, setStageFilter] = makeFlaggedPersisted(
    useEntryState<string[]>('soup.stageFilter', { default: [] }),
    { enabled: persist, name: 'soup-view-stage-filter-v2' }
  );
  const userId = crm.userId;
  const teamQuery = crm.createTeamSource();
  const ownerLabels = useContactFilterLabels(() =>
    ownerFilter().filter((id) => id !== NO_ASSIGNEE)
  );
  const ownerOptions = createLazyMemo((): SearchableOption[] => {
    const currentUserId = userId();
    const empty = noOwnerOption();
    let meOption: SearchableOption | undefined;
    const memberOptions: SearchableOption[] = [];
    for (const member of (teamQuery.isSuccess
      ? teamQuery.data?.members
      : undefined) ?? []) {
      const id = member.user_id;
      const name = idToDisplayName(id);
      const opt: SearchableOption = {
        id,
        label: buildContactLabel({ id, name }, currentUserId),
        icon: () => (
          <UserIcon
            id={id}
            name={name}
            size="sm"
            suppressClick
            showTooltip={false}
          />
        ),
      };
      if (id === currentUserId) {
        meOption = opt;
      } else {
        memberOptions.push(opt);
      }
    }
    memberOptions.sort((a, b) => a.label.localeCompare(b.label));
    return [...(meOption ? [meOption] : []), empty, ...memberOptions];
  });

  const stageOptions = createLazyMemo((): SearchableOption[] => [
    ...dealStages.filterStages().map((stage, index) => ({
      id: stage.id,
      label: stage.label,
      icon: () => (
        <CrmStageIcon optionId={stage.id} index={index} class="size-3.5" />
      ),
    })),
    {
      id: NO_STAGE,
      label: 'No stage',
      icon: () => <CircleDashedIcon class="size-3.5 text-ink-muted" />,
    },
  ]);

  const stageOptionsMap = createLazyMemo(
    (): Map<string, { label: string; icon?: () => JSX.Element }> => {
      const map = new Map<
        string,
        { label: string; icon?: () => JSX.Element }
      >();
      for (const option of stageOptions()) {
        map.set(option.id, { label: option.label, icon: option.icon });
      }
      return map;
    }
  );

  const actions = createCrmFilterSelections({
    ownerFilter,
    setOwnerFilter,
    stageFilter,
    setStageFilter,
    defaultStages: () => [
      ...dealStages.stages().map((stage) => stage.id),
      NO_STAGE,
    ],
    isActive: soup.predicates.isActive,
    toggle: (id) => soup.predicates.toggle({ and: [id] }),
  });
  // Leaving company presets clears their sub-filters, matching the legacy view lifecycle.
  createEffect(() => {
    if (
      !soup.predicates.isActive('crm-company-active') &&
      !soup.predicates.isActive('crm-company-hidden')
    ) {
      setOwnerFilter([]);
      setStageFilter([]);
    }
  });
  const facets: CollectionSelectFilter[] = [
    {
      id: 'stage',
      label: 'Stage',
      placeholder: 'Filter stages...',
      values: stageFilter,
      effectiveValues: actions.effectiveStages,
      options: stageOptions,
      chipOptions: stageOptions,
      chipValues: () =>
        stageFilter().map((id) => ({
          id,
          label: stageOptionsMap().get(id)?.label ?? id,
          icon: stageOptionsMap().get(id)?.icon,
        })),
      change: actions.changeStage,
      changeChip: actions.changeStageChip,
      clear: () => setStageFilter([]),
      active: () => stageFilter().length > 0,
      preserveOrder: true,
    },
    {
      id: 'owner',
      label: 'Owner',
      placeholder: 'Search owners...',
      values: ownerFilter,
      effectiveValues: ownerFilter,
      options: ownerOptions,
      createChipSource: useOwnerOptions,
      chipValues: () =>
        ownerFilter().map((id) => {
          const option =
            id === NO_ASSIGNEE ? noOwnerOption() : ownerLabels().get(id);
          return { id, label: option?.label ?? id, icon: option?.icon };
        }),
      change: actions.changeOwner,
      changeChip: actions.changeOwner,
      clear: () => setOwnerFilter([]),
    },
  ];
  return {
    facets,
    state: {
      ownerFilter,
      setOwnerFilter,
      stageFilter,
      setStageFilter,
    },
  };
}
