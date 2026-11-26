import { t } from '@app/lib/i18n';
import { MobileDrawer } from '@components/app/mobile/MobileDrawer';
import { triggerFocusNewElement } from '@core/directive/focusInput';
import ArrowLeftIcon from '@icon/system/regular/arrow-left.svg';
import CaretRightIcon from '@icon/system/regular/caret-right.svg';
import CheckIcon from '@icon/system/regular/check.svg';
import DatabaseIcon from '@icon/system/regular/database.svg';
import FunctionIcon from '@icon/system/regular/function.svg';
import {
  createEffect,
  createSignal,
  createUniqueId,
  For,
  type JSX,
  on,
  Show,
} from 'solid-js';
import {
  type ColumnTypeMenuProps,
  castDescription,
  createColumnTypeChoices,
} from '../../components/column-type-menu';
import { PropertyIcon } from '../../components/property-icon';
import type { ColumnMenuProps } from '../../context/column-menu';
import {
  castTargetOf,
  type DatabaseColumnCast,
  type DatabaseRelationTable,
} from '../../core/column-schema';

/**
 * A column's menu on touch: a sheet of its actions. Change type opens the
 * list of types in the same sheet, with Back, where a phone has no room for
 * a submenu beside the menu.
 */
export function ColumnMenuDrawer(props: ColumnMenuProps) {
  const [page, setPage] = createSignal<'actions' | 'types'>('actions');
  // The header closes this sheet itself once a type is chosen, so the page
  // follows `open`: every opening starts on the actions.
  createEffect(
    on(
      () => props.open,
      (open) => {
        if (!open) setPage('actions');
      },
      { defer: true }
    )
  );
  const actionsIn = (group: string) =>
    props.actions.filter((action) => action.group === group);
  const shown = (group: string) =>
    actionsIn(group).length > 0 || (group === 'edit' && !!props.types);
  const typeLabelId = createUniqueId();

  return (
    <MobileDrawer
      side="bottom"
      open={props.open}
      onOpenChange={props.onOpenChange}
      onFinalFocus={props.onClosed}
      restoreFocus
      preventScroll={false}
      preventScrollbarShift={false}
    >
      <MobileDrawer.Portal>
        <MobileDrawer.Overlay />
        <MobileDrawer.Content aria-label={`${props.column.name} column`}>
          <MobileDrawer.Handle />
          <p class="shrink-0 px-4 pb-4 text-sm font-medium break-words text-ink-muted">
            {props.column.name}
          </p>
          <MobileDrawer.ScrollBody>
            <Show
              when={page() === 'types' && props.types}
              fallback={
                <For each={['edit', 'view', 'delete']}>
                  {(group) => (
                    <Show when={shown(group)}>
                      <MobileDrawer.Section class="mb-3 flex shrink-0 flex-col last:mb-0">
                        <Show
                          when={
                            group === 'delete' &&
                            props.column.protections?.includes('delete')
                          }
                        >
                          <MobileDrawer.Item type="button" disabled>
                            This column cannot be deleted
                          </MobileDrawer.Item>
                        </Show>
                        <For each={actionsIn(group)}>
                          {(action) => (
                            <MobileDrawer.Item
                              type="button"
                              disabled={props.pending || action.disabled}
                              class={
                                group === 'delete'
                                  ? 'text-failure-ink'
                                  : undefined
                              }
                              onClick={() => {
                                if (action.focuses)
                                  triggerFocusNewElement(action.focuses, {
                                    touchOnly: true,
                                  });
                                action.run();
                                props.onOpenChange(false);
                              }}
                            >
                              <action.icon class="size-4 shrink-0" />
                              {action.label}
                            </MobileDrawer.Item>
                          )}
                        </For>
                        <Show when={group === 'edit' && props.types}>
                          {(types) => (
                            <ChangeTypeRow
                              types={types()}
                              pending={props.pending}
                              onOpen={() => setPage('types')}
                            />
                          )}
                        </Show>
                      </MobileDrawer.Section>
                    </Show>
                  )}
                </For>
              }
            >
              {(types) => (
                <ColumnTypePage
                  types={types()}
                  labelId={typeLabelId}
                  onBack={() => setPage('actions')}
                  onKeep={() => props.onOpenChange(false)}
                />
              )}
            </Show>
          </MobileDrawer.ScrollBody>
        </MobileDrawer.Content>
      </MobileDrawer.Portal>
    </MobileDrawer>
  );
}

/** The row that opens the types, naming the column's current one. */
function ChangeTypeRow(props: {
  types: ColumnTypeMenuProps;
  pending: boolean;
  onOpen: () => void;
}) {
  // The row names the type without the dry run, which starts with the list.
  const choices = createColumnTypeChoices(props.types, () => false);

  return (
    <MobileDrawer.Item
      type="button"
      disabled={choices.protectedType() || props.pending}
      onClick={props.onOpen}
    >
      <PropertyIcon
        type={props.types.column.dataType}
        entityType={props.types.column.specificEntityType}
        relation={!!props.types.column.relation}
        percentage={!!props.types.column.percentage}
      />
      <span class="flex-1 text-left">Change type</span>
      <Show
        when={!choices.protectedType()}
        fallback={<span class="text-xs text-ink-muted">Protected</span>}
      >
        <span class="max-w-[45%] truncate text-xs text-ink-muted">
          {choices.currentLabel()}
        </span>
      </Show>
      <CaretRightIcon class="size-3.5 shrink-0" />
    </MobileDrawer.Item>
  );
}

/** Every type the column can change to, with the current one checked. */
function ColumnTypePage(props: {
  types: ColumnTypeMenuProps;
  labelId: string;
  onBack: () => void;
  /** The column's own type was chosen: nothing changes. */
  onKeep: () => void;
}) {
  const choices = createColumnTypeChoices(props.types, () => true);
  const relationRow = (table: DatabaseRelationTable) => {
    const to = choices.relationTo(table);

    return (
      <TypeRow
        label={table.name}
        cast={choices.castOf(to)}
        icon={<PropertyIcon type="ENTITY" relation />}
        selected={choices.selected(to)}
        onSelect={() => {
          if (choices.selected(to)) props.onKeep();
          else choices.choose(table.name, to);
        }}
      />
    );
  };

  return (
    <>
      <MobileDrawer.Item type="button" onClick={props.onBack}>
        <ArrowLeftIcon class="size-4" />
        {t('common.back')}
      </MobileDrawer.Item>
      <MobileDrawer.Label id={props.labelId}>Change type</MobileDrawer.Label>
      <Show
        when={!choices.checking()}
        fallback={
          <p role="status" class="px-4 py-3 text-xs text-ink-muted">
            Checking values…
          </p>
        }
      >
        <MobileDrawer.Section
          aria-labelledby={props.labelId}
          class="flex shrink-0 flex-col"
        >
          <For each={choices.types()}>
            {(type) => (
              <TypeRow
                label={type.label}
                cast={choices.castOf(type.to)}
                icon={
                  <PropertyIcon
                    type={castTargetOf(type.to).dataType}
                    entityType={castTargetOf(type.to).specificEntityType}
                    percentage={!!castTargetOf(type.to).percentage}
                  />
                }
                selected={choices.selected(type.to)}
                onSelect={() => {
                  if (choices.selected(type.to)) props.onKeep();
                  else choices.choose(type.label, type.to);
                }}
              />
            )}
          </For>
          <Show when={props.types.onFormula}>
            {(onFormula) => (
              <MobileDrawer.Item
                type="button"
                disabled={choices.protectedType()}
                onClick={() => onFormula()()}
              >
                <FunctionIcon class="size-4 shrink-0 text-ink-muted" />
                Formula
              </MobileDrawer.Item>
            )}
          </Show>
        </MobileDrawer.Section>
        <Show when={choices.tablesHere().length}>
          <MobileDrawer.Label>Related table</MobileDrawer.Label>
          <MobileDrawer.Section class="flex shrink-0 flex-col">
            <For each={choices.tablesHere()}>{relationRow}</For>
          </MobileDrawer.Section>
        </Show>
        <For each={choices.databases()}>
          {(database) => (
            <>
              <MobileDrawer.Label>
                <span class="inline-flex min-w-0 items-center gap-1.5">
                  <DatabaseIcon class="size-3.5 shrink-0" />
                  <span class="truncate">{database.name}</span>
                </span>
              </MobileDrawer.Label>
              <MobileDrawer.Section class="flex shrink-0 flex-col">
                <For each={database.tables}>{relationRow}</For>
              </MobileDrawer.Section>
            </>
          )}
        </For>
      </Show>
    </>
  );
}

/** One offered type; a checked one says which values do not fit. */
function TypeRow(props: {
  label: string;
  cast: DatabaseColumnCast | undefined;
  icon: JSX.Element;
  selected: boolean;
  onSelect: () => void;
}) {
  return (
    <MobileDrawer.Item
      type="button"
      aria-current={props.selected ? 'true' : undefined}
      onClick={props.onSelect}
    >
      {props.icon}
      <span class="flex min-w-0 flex-1 flex-col text-left">
        <span class="truncate">{props.label}</span>
        <Show when={castDescription(props.cast)}>
          {(text) => <span class="text-xs text-ink-muted">{text()}</span>}
        </Show>
      </span>
      <Show when={props.selected}>
        <CheckIcon class="size-3.5 shrink-0" />
      </Show>
    </MobileDrawer.Item>
  );
}
