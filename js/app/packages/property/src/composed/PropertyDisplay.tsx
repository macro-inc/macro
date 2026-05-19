import { EntityIcon } from '@core/component/Properties/component/propertyValue/EntityIcon';
import { PropertyValueIcon } from '@core/component/Properties/component/propertyValue/PropertyValueIcon';
import type { EntityType } from '@service-properties/generated/schemas/entityType';
import { cn } from '@ui';
import { For, Match, Show, Switch } from 'solid-js';
import { useProperty } from '../core/context';
import { InlineEditor } from '../editors/inline/InlineEditor';
import { PopoverEditor } from '../editors/popover/PopoverEditor';
import { PropertyAddButton } from '../extractors/PropertyAddButton';
import { PropertyEditTrigger } from '../extractors/PropertyEditTrigger';
import { PropertyEmpty } from '../extractors/PropertyEmpty';
import { PropertyRemoveButton } from '../extractors/PropertyRemoveButton';
import { PropertyText } from '../extractors/PropertyText';
import {
  formatDate,
  formatPropertyValue,
  getEntityValues,
  getSelectValues,
  hasValue,
} from '../utils';

export type PropertyDisplayProps = {
  /**
   * Forwarded to PopoverEditor when the property is an ENTITY type — filters
   * the owning entity out of the picker.
   */
  entitySelfFilter?: { entityType: EntityType; blockId?: string };
};

/**
 * Opinionated composition of display + editing affordances. Drop-in
 * replacement for the legacy PropertyValue router.
 *
 * Routes by valueType:
 * - STRING / NUMBER / BOOLEAN / LINK: <Property.InlineEditor>
 * - DATE / SELECT (single): button with formatted text + RemoveButton on
 *   hover, opens popover
 * - SELECT (multi): chip list with per-chip RemoveButton + AddButton
 * - ENTITY: legacy EntityIcon per value (handles entity-name resolution and
 *   navigation) + AddButton when applicable
 *
 * Must be inside <Property.Root>.
 */
export function PropertyDisplay(props: PropertyDisplayProps) {
  const ctx = useProperty();
  const property = () => ctx.property();
  const isReadOnly = () => !ctx.canEdit() || !!property().isMetadata;
  const isInline = () => {
    const t = property().valueType;
    return t === 'STRING' || t === 'NUMBER' || t === 'BOOLEAN' || t === 'LINK';
  };

  return (
    <Switch>
      <Match when={isInline()}>
        <InlineEditor />
      </Match>
      <Match when={property().valueType === 'DATE'}>
        <DateDisplay />
        <PopoverEditor entitySelfFilter={props.entitySelfFilter} />
      </Match>
      <Match
        when={
          (property().valueType === 'SELECT_STRING' ||
            property().valueType === 'SELECT_NUMBER') &&
          !property().isMultiSelect
        }
      >
        <SingleSelectDisplay />
        <PopoverEditor entitySelfFilter={props.entitySelfFilter} />
      </Match>
      <Match
        when={
          property().valueType === 'SELECT_STRING' ||
          property().valueType === 'SELECT_NUMBER'
        }
      >
        <MultiSelectDisplay isReadOnly={isReadOnly()} />
        <PopoverEditor entitySelfFilter={props.entitySelfFilter} />
      </Match>
      <Match when={property().valueType === 'ENTITY'}>
        <EntityDisplay isReadOnly={isReadOnly()} />
        <PopoverEditor entitySelfFilter={props.entitySelfFilter} />
      </Match>
    </Switch>
  );
}

function DateDisplay() {
  const ctx = useProperty();
  const property = () => ctx.property();
  const display = () =>
    property().valueType === 'DATE' && property().value != null
      ? formatDate(property().value as Date)
      : '';

  return (
    <div
      class={cn(
        'group relative inline-flex max-w-full shrink-0 rounded-sm',
        ctx.canEdit() && !property().isMetadata && 'hover:bg-hover'
      )}
    >
      <PropertyEditTrigger class="inline-flex items-center leading-none shrink-0 p-1.5 h-6.5 transition-colors">
        <Show when={display()} fallback={<PropertyEmpty label="Empty" />}>
          <span class="block truncate max-w-full">{display()}</span>
        </Show>
      </PropertyEditTrigger>
      <Show
        when={hasValue(property()) && ctx.canEdit() && !property().isMetadata}
      >
        <div class="absolute right-0 inset-y-0 hidden items-center pr-1 pl-2 bg-linear-to-r from-transparent to-hover to-40% rounded-r-sm group-hover:flex">
          <PropertyRemoveButton />
        </div>
      </Show>
    </div>
  );
}

function SingleSelectDisplay() {
  const ctx = useProperty();
  const property = () => ctx.property();
  const value = () => getSelectValues(property())[0];
  const label = () =>
    value() ? formatPropertyValue(property(), value()!) : '';

  return (
    <div
      class={cn(
        'group relative inline-flex max-w-35 shrink-0 rounded-sm',
        ctx.canEdit() && !property().isMetadata && 'hover:bg-hover'
      )}
    >
      <PropertyEditTrigger class="text-left px-2 py-0.5 bg-transparent inline-flex items-center gap-1.5 w-full">
        <Show when={value()}>
          {(id) => <PropertyValueIcon optionId={id()} />}
        </Show>
        <Show when={label()} fallback={<PropertyEmpty label="Empty" />}>
          <span class="block truncate">{label()}</span>
        </Show>
      </PropertyEditTrigger>
      <Show when={value() && ctx.canEdit() && !property().isMetadata}>
        <div class="absolute right-0 inset-y-0 hidden items-center pr-1 pl-2 bg-linear-to-r from-transparent to-hover to-40% rounded-r-sm group-hover:flex">
          <PropertyRemoveButton />
        </div>
      </Show>
    </div>
  );
}

function MultiSelectDisplay(props: { isReadOnly: boolean }) {
  const ctx = useProperty();
  const property = () => ctx.property();
  const values = () => getSelectValues(property());

  return (
    <div class="flex flex-wrap gap-2 justify-start items-start w-full min-w-0">
      <For each={values()}>
        {(value) => (
          <div class="group relative inline-flex max-w-35 shrink-0 rounded-sm hover:bg-hover">
            <div
              class="text-left px-2 py-0.5 bg-transparent cursor-default inline-flex items-center gap-1.5"
              title={formatPropertyValue(property(), value)}
            >
              <PropertyValueIcon optionId={value} />
              <span class="block truncate">
                {formatPropertyValue(property(), value)}
              </span>
            </div>
            <Show when={!props.isReadOnly}>
              <div class="absolute right-0 inset-y-0 hidden items-center pr-1 pl-2 bg-linear-to-r from-transparent to-hover to-40% rounded-r-sm group-hover:flex">
                <PropertyRemoveButton valueToRemove={value} />
              </div>
            </Show>
          </div>
        )}
      </For>
      <Show
        when={!props.isReadOnly}
        fallback={
          <Show when={values().length === 0}>
            <div class="text-ink-muted px-2 py-0.5 bg-transparent inline-block shrink-0 rounded-sm">
              <PropertyEmpty label="Empty" />
            </div>
          </Show>
        }
      >
        <PropertyAddButton />
      </Show>
    </div>
  );
}

function EntityDisplay(props: { isReadOnly: boolean }) {
  const ctx = useProperty();
  const property = () => ctx.property();
  const entities = () => getEntityValues(property());

  const handleRemoveEntity = async (entityId: string) => {
    const remaining = entities().filter((e) => e.entity_id !== entityId);
    await ctx.onSave?.(property(), {
      valueType: 'ENTITY',
      refs: remaining.length > 0 ? remaining : null,
    });
    ctx.onRefresh?.();
  };

  return (
    <div class="flex flex-wrap gap-1 justify-start items-start w-full min-w-0">
      <For each={entities()}>
        {(entityRef) => (
          <EntityIcon
            property={property()}
            entityId={entityRef.entity_id}
            entityType={entityRef.entity_type}
            specificMessageId={entityRef.specific_message_id}
            canEdit={!props.isReadOnly}
            onRemove={() => handleRemoveEntity(entityRef.entity_id)}
            onEdit={(anchor) => {
              if (props.isReadOnly) return;
              if (ctx.onEdit) ctx.onEdit(property(), anchor);
              else ctx.openEditor(anchor);
            }}
          />
        )}
      </For>
      <Show
        when={!props.isReadOnly}
        fallback={
          <Show when={entities().length === 0}>
            <div class="text-ink-muted px-2 py-0.5 bg-transparent inline-block shrink-0 rounded-sm">
              <PropertyEmpty label="Empty" />
            </div>
          </Show>
        }
      >
        <Show when={entities().length === 0 || property().isMultiSelect}>
          <PropertyAddButton />
        </Show>
      </Show>
    </div>
  );
}

/**
 * Condensed (icon-only pill) display — used in inline mention contexts and
 * compact list views. Falls back to PropertyEmpty when no value.
 */
export function PropertyDisplayCondensed(props: PropertyDisplayProps) {
  const ctx = useProperty();
  const property = () => ctx.property();
  const valid = () => hasValue(property());

  return (
    <>
      <PropertyEditTrigger
        class={cn(
          'inline-flex items-center text-xs leading-none text-ink-muted shrink-0 p-1.5 h-6.5 transition-colors rounded-sm',
          ctx.canEdit() && 'hover:bg-hover',
          !valid() && 'opacity-50'
        )}
      >
        <PropertyText
          property={property()}
          fallback={<PropertyEmpty label="" />}
        />
      </PropertyEditTrigger>
      <PopoverEditor entitySelfFilter={props.entitySelfFilter} />
    </>
  );
}
