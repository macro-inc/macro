import {
  type ListControlOption,
  ListFilterDropdown,
  type ListFilterGroup,
  ListGroupDropdown,
  MobileFilterDrawer,
} from '@app/components/view-shell';
import { t } from '@app/lib/i18n';
import { HeaderActionGroup } from '@components/app/HeaderActionGroup';
import { MobileDrawer } from '@components/app/mobile/MobileDrawer';
import { Accordion } from '@kobalte/core/accordion';
import { For } from 'solid-js';
import { Dynamic } from 'solid-js/web';
import { PASSWORD_KINDS } from '../core/kinds';
import type { PasswordGroupBy, PasswordKind } from '../core/types';
import { KIND_ICONS } from './kind-icon';

type PasswordTypeControlsProps = {
  kinds: readonly PasswordKind[];
  groupBy: PasswordGroupBy;
  onKindChange: (kind: PasswordKind, selected: boolean) => void;
  onClearKinds: () => void;
  onGroupByChange: (groupBy: PasswordGroupBy) => void;
};

const kindOptions = (): ListControlOption<PasswordKind>[] =>
  PASSWORD_KINDS.map((kind) => ({
    id: kind,
    label: t(`passwords.${kind}`),
    icon: () => <Dynamic component={KIND_ICONS[kind]} class="size-3.5" />,
  }));

const groupOptions = (): ListControlOption<PasswordGroupBy>[] => [
  { id: 'none', label: t('viewMenus.groupNone') },
  { id: 'kind', label: t('passwords.kind') },
];

/** The list header's type filter and grouping, from the Tasks header's menus. */
export function PasswordTypeControls(props: PasswordTypeControlsProps) {
  const groups = (): ListFilterGroup<'kind', PasswordKind>[] => [
    { id: 'kind', label: t('passwords.kind'), options: kindOptions() },
  ];
  return (
    <>
      <HeaderActionGroup label={t('passwords.typeFilter')} size="md">
        <ListFilterDropdown
          grouped
          size={props.kinds.length ? 'md' : 'icon-md'}
          label={t('passwords.filterItems')}
          activeCount={props.kinds.length}
          groups={groups()}
          isSelected={(_, kind) => props.kinds.includes(kind)}
          onSelectionChange={(_, kind, selected) =>
            props.onKindChange(kind, selected)
          }
          onClear={props.onClearKinds}
        />
      </HeaderActionGroup>
      <HeaderActionGroup label={t('passwords.listOptions')} size="md">
        <ListGroupDropdown
          grouped
          size="icon-md"
          label={t('passwords.groupItems')}
          value={props.groupBy}
          options={groupOptions()}
          onChange={props.onGroupByChange}
        />
      </HeaderActionGroup>
    </>
  );
}

/** The phone's filter drawer, laid out like the Tasks drawer. */
export function PasswordTypeDrawer(props: PasswordTypeControlsProps) {
  return (
    <MobileFilterDrawer
      triggerLabel={t('passwords.openFilters')}
      label={t('passwords.listControls')}
      activeCount={props.kinds.length}
      onClear={props.onClearKinds}
    >
      <MobileDrawer.Label id="passwords-group-label" class="pt-4">
        {t('passwords.group')}
      </MobileDrawer.Label>
      <MobileDrawer.Section
        role="radiogroup"
        aria-labelledby="passwords-group-label"
      >
        <For each={groupOptions()}>
          {(option) => (
            <MobileFilterDrawer.Option
              selectionMode="single"
              checked={props.groupBy === option.id}
              onChange={() => props.onGroupByChange(option.id)}
            >
              {option.label}
            </MobileFilterDrawer.Option>
          )}
        </For>
      </MobileDrawer.Section>
      <MobileDrawer.Label class="pt-4">
        {t('viewMenus.filters')}
      </MobileDrawer.Label>
      <Accordion multiple collapsible defaultValue={['kind']}>
        <MobileFilterDrawer.Section
          value="kind"
          label={t('passwords.kind')}
          activeCount={props.kinds.length}
        >
          <For each={kindOptions()}>
            {(option) => (
              <MobileFilterDrawer.Option
                checked={props.kinds.includes(option.id)}
                onChange={(checked) => props.onKindChange(option.id, checked)}
                icon={option.icon?.()}
              >
                {option.label}
              </MobileFilterDrawer.Option>
            )}
          </For>
        </MobileFilterDrawer.Section>
      </Accordion>
    </MobileFilterDrawer>
  );
}
