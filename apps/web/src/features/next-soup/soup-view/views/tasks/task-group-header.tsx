import type { GroupHeaderProps } from '@app/features/next-soup/create-soup-state';
import { SoupSectionHeader } from '@app/features/next-soup/soup-view/section-header';
import { useSoupView } from '@app/features/next-soup/soup-view/soup-view-context';
import { UserIcon } from '@core/component/UserIcon';
import { type MacroId, tryMacroId, useDisplayName } from '@core/user';
import ChevronRightIcon from '@phosphor/caret-right.svg';
import CircleDashed from '@phosphor/circle-dashed.svg';
import { PROPERTY_OPTION_IDS, SYSTEM_PROPERTY_IDS } from '@property';
import { PropertyValueIcon } from '@property/component/propertyValue';
import { cn, Layer } from '@ui';
import { createMemo, Match, Switch } from 'solid-js';

const AssigneeGroupContent = (props: {
  assigneeId: MacroId;
  fallbackLabel: string;
}) => {
  const [assigneeName] = useDisplayName(props.assigneeId, {
    emailFallback: 'local-part',
  });
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

const STATUS_GROUP_HEADER_TINTS: Record<string, string> = {
  [PROPERTY_OPTION_IDS.STATUS.NOT_STARTED]:
    'bg-task/5 border-task/10 data-highlighted:bg-task/10 hover:bg-task/10',
  [PROPERTY_OPTION_IDS.STATUS.IN_PROGRESS]:
    'bg-alert/5 border-alert/10 data-highlighted:bg-alert/10 hover:bg-alert/10',
  [PROPERTY_OPTION_IDS.STATUS.IN_REVIEW]:
    'bg-note/5 border-note/10 data-highlighted:bg-note/10 hover:bg-note/10',
  [PROPERTY_OPTION_IDS.STATUS.COMPLETED]:
    'bg-accent/5 border-accent/10 data-highlighted:bg-accent/10 hover:bg-accent/10',
  [PROPERTY_OPTION_IDS.STATUS.CANCELED]:
    'bg-ink/5 border-ink/10 data-highlighted:bg-ink/10 hover:bg-ink/10',
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

  const statusTint = createMemo(() => {
    const field = groupByField();
    if (
      field?.type !== 'property' ||
      field.propertyDefinitionId !== SYSTEM_PROPERTY_IDS.STATUS
    ) {
      return;
    }

    const optionId = props.group.value ?? props.group.key;
    if (typeof optionId !== 'string') return;

    return STATUS_GROUP_HEADER_TINTS[optionId];
  });

  return (
    <SoupSectionHeader
      onClick={() => props.group.toggle()}
      highlighted={props.highlighted}
      class={statusTint()}
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
