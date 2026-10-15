import type { GroupHeaderProps } from '@app/features/next-soup/create-soup-state';
import { SoupSectionHeader } from '@app/features/next-soup/soup-view/section-header';
import { useSoupView } from '@app/features/next-soup/soup-view/soup-view-context';
import { UserIcon } from '@core/component/UserIcon';
import { getDisplayName, type MacroId, tryMacroId } from '@core/user';
import ChevronRightIcon from '@icon/system/regular/caret-right.svg';
import CircleDashed from '@icon/system/regular/circle-dashed.svg';
import { SYSTEM_PROPERTY_IDS } from '@property';
import { PropertyValueIcon } from '@property/component/propertyValue';
import { cn, Layer } from '@ui';
import { createMemo, Match, Switch } from 'solid-js';

const AssigneeGroupContent = (props: {
  assigneeId: MacroId;
  fallbackLabel: string;
}) => {
  const assigneeName = () =>
    getDisplayName(props.assigneeId, { emailFallback: 'local-part' });
  return (
    <>
      <UserIcon
        id={props.assigneeId}
        size="sm"
        suppressClick
        showTooltip={false}
      />
      <span class="truncate">
        {assigneeName() || props.assigneeId || props.fallbackLabel}
      </span>
    </>
  );
};

export const TaskGroupHeader = (
  props: GroupHeaderProps & { highlighted?: boolean }
) => {
  const { groupByField } = useSoupView();
  const assigneeId = createMemo(() => {
    const field = groupByField();
    if (
      field?.type !== 'property' ||
      (field.propertyDefinitionId !== SYSTEM_PROPERTY_IDS.ASSIGNEES &&
        field.propertyDefinitionId !== SYSTEM_PROPERTY_IDS.COMPANY_OWNER) ||
      props.group.key === ''
    ) {
      return;
    }
    return tryMacroId(props.group.key);
  });

  return (
    <SoupSectionHeader
      onClick={() => props.group.toggle()}
      highlighted={props.highlighted}
    >
      <Layer depth={3}>
        <div class="flex items-center justify-center size-4.5 rounded-xs group-hover/header:bg-ink/5">
          <ChevronRightIcon
            class={cn('size-2.5', {
              'rotate-90': props.group.isExpanded(),
            })}
          />
        </div>
      </Layer>
      <Switch>
        <Match when={assigneeId()}>
          {(id) => (
            <AssigneeGroupContent
              assigneeId={id()}
              fallbackLabel={props.group.label}
            />
          )}
        </Match>
        <Match
          when={typeof props.group.value !== 'string' || !props.group.value}
        >
          <CircleDashed class="size-3.5 text-ink-extra-muted" />

          <span class="truncate">{props.group.label}</span>
        </Match>
        <Match
          when={typeof props.group.value === 'string' && props.group.value}
        >
          {(value) => (
            <>
              <PropertyValueIcon optionId={value()} class="size-3.5" />
              <span class="truncate">{props.group.label}</span>
            </>
          )}
        </Match>
      </Switch>
      <span
        class={cn(
          'shrink-0 tabular-nums text-xs font-medium',
          'px-1.5 py-px rounded-full bg-ink/10 text-ink-extra-muted'
        )}
      >
        {props.group.count}
      </span>
    </SoupSectionHeader>
  );
};
