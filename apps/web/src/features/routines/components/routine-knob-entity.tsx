import { PickerSheet } from '@components/app/mobile/PickerSheet';
import { EntityIcon } from '@core/component/EntityIcon';
import { UserIcon } from '@core/component/UserIcon';
import { useQuickAccess } from '@core/context/quickAccess';
import { isTouchDevice } from '@core/mobile/isTouchDevice';
import MagnifyingGlassIcon from '@icon/system/regular/magnifying-glass.svg';
import { PropertyEntitySelector } from '@property/editors/selectors/PropertyEntitySelector';
import { usePropertyEntityDisplay } from '@property/hooks';
import type { EntityType } from '@service-properties/generated/schemas/entityType';
import { Button, InputGroup, RadioGroup } from '@ui';
import { createSignal, For, Show, Suspense } from 'solid-js';
import {
  aEntityKnob,
  type Knob,
  type KnobEntity,
  knobPickerType,
  knobTypeOfPicked,
} from '../core/knobs';

type EntityKnob = Extract<Knob, { type: 'entity' }>;

function pickerTypes(knob: EntityKnob): EntityType[] {
  return knob.entity_types.flatMap((type) => knobPickerType(type) ?? []);
}

/** The picked item's icon and name, as the step's sentence shows it. */
export function KnobEntityValue(props: { knob: EntityKnob }) {
  return (
    <Show when={props.knob.value} keyed>
      {(value) => (
        <span class="inline-flex max-w-full items-center gap-1 align-bottom">
          <Show
            when={knobPickerType(value.type)}
            keyed
            fallback={<DatabaseName id={value.id} />}
          >
            {(type) => <EntityName id={value.id} type={type} />}
          </Show>
        </span>
      )}
    </Show>
  );
}

function EntityName(props: { id: string; type: EntityType }) {
  const display = usePropertyEntityDisplay(
    () => props.id,
    () => props.type
  );
  return (
    <>
      <span class="inline-flex shrink-0">
        <Show when={props.type === 'USER'} fallback={display.icon()}>
          {/* The avatar's own click (a DM, or the user card on touch)
              would take the tap that opens the knob's editor. */}
          <UserIcon id={props.id} size="sm" suppressClick showTooltip={false} />
        </Show>
      </span>
      <span class="truncate">{display.name()}</span>
    </>
  );
}

function DatabaseName(props: { id: string }) {
  const databases = useQuickAccess().useList('database').items;
  const name = () =>
    databases().find((item) => item.id === props.id)?.data.name ?? 'Database';
  return (
    <>
      <EntityIcon targetType="database" size="xs" class="shrink-0" />
      <span class="truncate">{name()}</span>
    </>
  );
}

/**
 * The items an entity knob can take, to pick one into a draft: the app's
 * entity picker, or the databases Macro knows the owner has. Picking never
 * saves, Enter included; the editor around it saves.
 */
export function KnobEntityPicker(props: {
  knob: EntityKnob;
  value: KnobEntity | null;
  problem: string | undefined;
  onInput(value: KnobEntity | null): void;
  /** Escape in the search. */
  onCancel(): void;
}) {
  return (
    <div class="flex min-h-0 flex-auto flex-col gap-1.5">
      <Show
        when={pickerTypes(props.knob).length}
        fallback={
          <DatabaseList
            knob={props.knob}
            value={props.value}
            onInput={props.onInput}
          />
        }
      >
        <EntityList
          knob={props.knob}
          value={props.value}
          onInput={props.onInput}
          onCancel={props.onCancel}
        />
      </Show>
      <Show when={props.problem}>
        {(problem) => (
          <p class="shrink-0 px-1 text-xs text-ink-muted">{problem()}</p>
        )}
      </Show>
    </div>
  );
}

function EntityList(props: {
  knob: EntityKnob;
  value: KnobEntity | null;
  onInput(value: KnobEntity | null): void;
  onCancel(): void;
}) {
  const types = () => pickerTypes(props.knob);
  const select = (
    ids: Set<string>,
    picked?: { id: string; entity_type: EntityType }[]
  ) => {
    const id = ids.values().next().value;
    // The selector reports picking the picked row again as no selection: a
    // click on it, or Enter while it is highlighted, as it is on opening and
    // after a click. Keep the pick: only Clear empties it.
    if (!id) return;
    const entityType = picked?.find((entity) => entity.id === id)?.entity_type;
    const [first, ...rest] = types();
    const only = first && !rest.length ? knobTypeOfPicked(first) : undefined;
    const type = entityType ? knobTypeOfPicked(entityType) : only;
    if (!type || !props.knob.entity_types.includes(type)) return;
    props.onInput({ type, id });
  };
  return (
    <Suspense fallback={<p class="p-3 text-sm text-ink-muted">Loading…</p>}>
      <PropertyEntitySelector
        config={{
          isMultiSelect: false,
          placeholder: `Find ${aEntityKnob(props.knob)}`,
          specificEntityType: types().length === 1 ? types()[0] : types(),
          fillHeight: isTouchDevice(),
        }}
        selectedOptions={() => new Set(props.value ? [props.value.id] : [])}
        setSelectedOptions={select}
        onCancel={props.onCancel}
      />
    </Suspense>
  );
}

function databaseName(database: { data: { name?: string | null } }) {
  return database.data.name || 'Untitled database';
}

function DatabaseList(props: {
  knob: EntityKnob;
  value: KnobEntity | null;
  onInput(value: KnobEntity | null): void;
}) {
  const all = useQuickAccess().useList('database').items;
  const [query, setQuery] = createSignal('');
  const databases = () => {
    const words = query().trim().toLowerCase();
    return all().filter(
      (item) => !words || databaseName(item).toLowerCase().includes(words)
    );
  };
  // On touch the search field keeps the keyboard while a row is picked.
  const keepFocus = (event: Event) => {
    if (isTouchDevice()) event.preventDefault();
  };
  return (
    <div class="flex min-h-0 flex-auto flex-col gap-2">
      <InputGroup class="shrink-0">
        <InputGroup.Input
          // A text field, so the touch sheet hands it the keyboard.
          type="text"
          value={query()}
          onInput={(event) => setQuery(event.currentTarget.value)}
          placeholder="Find a database"
          aria-label="Find a database"
        />
        <InputGroup.Addon align="inline-start">
          <MagnifyingGlassIcon aria-hidden="true" />
        </InputGroup.Addon>
      </InputGroup>
      <Show
        when={databases().length}
        fallback={<p class="px-1 text-sm text-ink-muted">No databases found</p>}
      >
        <RadioGroup
          class="min-h-0 overflow-y-auto text-sm text-ink"
          // Cleared, no database is picked.
          value={props.value?.id ?? ''}
          onChange={(id) => props.onInput({ type: 'database', id })}
          onPointerDown={keepFocus}
          onMouseDown={keepFocus}
        >
          <RadioGroup.Label class="sr-only">
            {props.knob.label}
          </RadioGroup.Label>
          <For each={databases()}>
            {(database) => (
              <RadioGroup.Item value={database.id} class="touch:min-h-11">
                <RadioGroup.ItemControl />
                <RadioGroup.ItemLabel class="flex min-w-0 flex-1 items-center gap-1.5 self-stretch">
                  <EntityIcon
                    targetType="database"
                    size="xs"
                    class="shrink-0"
                  />
                  <span class="truncate">{databaseName(database)}</span>
                </RadioGroup.ItemLabel>
              </RadioGroup.Item>
            )}
          </For>
        </RadioGroup>
      </Show>
    </div>
  );
}

/**
 * An entity knob's picker on touch: a sheet stacked over the page, as the
 * app's other searchable pickers are. Picks stay a draft until Done; Clear
 * empties it and Cancel drops it.
 */
export function KnobEntitySheet(props: {
  knob: EntityKnob;
  open: boolean;
  value: KnobEntity | null;
  problem: string | undefined;
  /** Why the saved item needs a new pick, under the list while it is picked. */
  notice?: string;
  onInput(value: KnobEntity | null): void;
  onCancel(): void;
  onSave(): void;
}) {
  return (
    <PickerSheet.Root open={props.open} onCancel={props.onCancel}>
      <div on:keydown={(event) => event.stopPropagation()}>
        <PickerSheet.Header
          title={props.knob.label}
          onDone={props.onSave}
          doneDisabled={!!props.problem}
        />
        <div class="flex justify-end px-4 pb-2">
          <Button
            type="button"
            variant="ghost"
            size="sm"
            disabled={!props.value}
            // The search field keeps the keyboard.
            onPointerDown={(event) => event.preventDefault()}
            onMouseDown={(event) => event.preventDefault()}
            onClick={() => props.onInput(null)}
          >
            Clear
          </Button>
        </div>
      </div>
      <PickerSheet.Body>
        <KnobEntityPicker
          knob={props.knob}
          value={props.value}
          problem={props.notice}
          onInput={props.onInput}
          onCancel={props.onCancel}
        />
      </PickerSheet.Body>
    </PickerSheet.Root>
  );
}
