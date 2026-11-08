import { PickerSheet } from '@components/app/mobile/PickerSheet';
import { EntityIcon } from '@core/component/EntityIcon';
import { useQuickAccess } from '@core/context/quickAccess';
import { isTouchDevice } from '@core/mobile/isTouchDevice';
import { EditorPopover } from '@property/editors/popover/EditorPopover';
import { PropertyEntitySelector } from '@property/editors/selectors/PropertyEntitySelector';
import { usePropertyEntityDisplay } from '@property/hooks';
import type { EntityType } from '@service-properties/generated/schemas/entityType';
import { Dropdown } from '@ui';
import { createSignal, Show, Suspense } from 'solid-js';
import { match } from 'ts-pattern';
import {
  entityKnobNoun,
  type Knob,
  type KnobEntity,
  type KnobEntityType,
} from '../core/knobs';
import { SearchMenu } from './routine-search-menu';

type EntityKnob = Extract<Knob, { type: 'entity' }>;

/** The app's entity type for a kind the entity picker offers. */
function pickerType(type: KnobEntityType): EntityType | undefined {
  return (
    match(type)
      .returnType<EntityType | undefined>()
      .with('channel', () => 'CHANNEL')
      .with('document', () => 'DOCUMENT')
      .with('project', () => 'PROJECT')
      .with('user', () => 'USER')
      // Databases aren't entity property targets; they have their own menu.
      .with('database', () => undefined)
      .exhaustive()
  );
}

function knobType(type: EntityType): KnobEntityType | undefined {
  return match(type)
    .returnType<KnobEntityType | undefined>()
    .with('CHANNEL', () => 'channel')
    .with('DOCUMENT', () => 'document')
    .with('PROJECT', () => 'project')
    .with('USER', () => 'user')
    .otherwise(() => undefined);
}

function pickerTypes(knob: EntityKnob): EntityType[] {
  return knob.entity_types.flatMap((type) => pickerType(type) ?? []);
}

function samePick(a: KnobEntity | null, b: KnobEntity | null) {
  return a?.type === b?.type && a?.id === b?.id;
}

/**
 * An entity knob's item, picked from the app's entity picker (a popover on
 * desktop, a picker sheet on touch) and shown by its name and icon. A
 * database knob picks from the databases Macro knows the owner has.
 */
export function KnobEntityControl(props: {
  knob: EntityKnob;
  /** The underlined value's classes, shared with the other knobs. */
  class: string;
  onChange(value: KnobEntity): void;
}) {
  return (
    <Show
      when={pickerTypes(props.knob).length}
      fallback={
        <DatabaseKnobMenu knob={props.knob} onChange={props.onChange} />
      }
    >
      <EntityKnobPicker
        knob={props.knob}
        class={props.class}
        onChange={props.onChange}
      />
    </Show>
  );
}

function EntityKnobPicker(props: {
  knob: EntityKnob;
  class: string;
  onChange(value: KnobEntity): void;
}) {
  const [open, setOpen] = createSignal(false);
  // The sheet applies its pick on Done; the popover applies it at once.
  const [draft, setDraft] = createSignal<KnobEntity | null>(null);
  let trigger: HTMLButtonElement | undefined;
  const types = () => pickerTypes(props.knob);
  const changeOpen = (next: boolean) => {
    if (next) setDraft(props.knob.value);
    setOpen(next);
    if (!next && !isTouchDevice()) trigger?.focus();
  };
  const choose = (value: KnobEntity) => {
    changeOpen(false);
    if (!samePick(value, props.knob.value)) props.onChange(value);
  };
  const select = (
    ids: Set<string>,
    picked?: { id: string; entity_type: EntityType }[]
  ) => {
    const id = ids.values().next().value;
    if (!id) return;
    const entityType = picked?.find((entity) => entity.id === id)?.entity_type;
    const only = types().length === 1 ? props.knob.entity_types[0] : undefined;
    const type = entityType ? knobType(entityType) : only;
    if (!type || !props.knob.entity_types.includes(type)) return;
    if (isTouchDevice()) setDraft({ type, id });
    else choose({ type, id });
  };
  const noun = () => entityKnobNoun(props.knob);
  const selector = () => (
    <Suspense
      fallback={<p class="p-3 text-sm text-ink-muted">Loading {noun()}s…</p>}
    >
      <PropertyEntitySelector
        config={{
          isMultiSelect: false,
          placeholder: `Find a ${noun()}`,
          specificEntityType: types().length === 1 ? types()[0] : types(),
          fillHeight: isTouchDevice(),
        }}
        selectedOptions={() => new Set(draft() ? [draft()!.id] : [])}
        setSelectedOptions={select}
        onCancel={() => changeOpen(false)}
      />
    </Suspense>
  );
  const button = () => (
    <button
      ref={trigger}
      type="button"
      class={props.class}
      aria-label={`${props.knob.label}: ${props.knob.value ? 'change it' : `pick a ${noun()}`}`}
      aria-expanded={open()}
      aria-haspopup="dialog"
      // The sheet's search field keeps the keyboard.
      onPointerDown={(event) => {
        if (isTouchDevice()) event.preventDefault();
      }}
      onMouseDown={(event) => {
        if (isTouchDevice()) event.preventDefault();
      }}
      onClick={() => changeOpen(true)}
    >
      <KnobEntityValue knob={props.knob} />
    </button>
  );
  return (
    <Show
      when={isTouchDevice()}
      fallback={
        <Dropdown
          open={open()}
          onOpenChange={changeOpen}
          getAnchorRect={() => trigger?.getBoundingClientRect()}
          placement="bottom-start"
          fitViewport
        >
          {button()}
          <Show when={open()}>
            <EditorPopover onClose={() => changeOpen(false)}>
              {selector()}
            </EditorPopover>
          </Show>
        </Dropdown>
      }
    >
      {button()}
      <PickerSheet.Root open={open()} onCancel={() => changeOpen(false)}>
        <div on:keydown={(event) => event.stopPropagation()}>
          <PickerSheet.Header
            title={props.knob.label}
            onDone={() => {
              const value = draft();
              if (value) choose(value);
              else changeOpen(false);
            }}
            doneDisabled={!draft()}
          />
        </div>
        <PickerSheet.Body>{selector()}</PickerSheet.Body>
      </PickerSheet.Root>
    </Show>
  );
}

/** The item's icon and name, or what to pick when there is none. */
export function KnobEntityValue(props: { knob: EntityKnob }) {
  return (
    <Show
      when={props.knob.value}
      keyed
      fallback={`Pick a ${entityKnobNoun(props.knob)}`}
    >
      {(value) => (
        <span class="inline-flex max-w-full items-center gap-1 align-bottom">
          <Show
            when={pickerType(value.type)}
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
      <span class="inline-flex shrink-0">{display.icon()}</span>
      <span class="truncate">{display.name()}</span>
    </>
  );
}

function DatabaseName(props: { id: string }) {
  const quickAccess = useQuickAccess();
  const name = () =>
    quickAccess
      .useList('database')
      .items()
      .find((item) => item.id === props.id)?.data.name ?? 'Database';
  return (
    <>
      <EntityIcon targetType="database" size="xs" class="shrink-0" />
      <span class="truncate">{name()}</span>
    </>
  );
}

function DatabaseKnobMenu(props: {
  knob: EntityKnob;
  onChange(value: KnobEntity): void;
}) {
  const quickAccess = useQuickAccess();
  const items = () =>
    quickAccess
      .useList('database')
      .items()
      .map((item) => ({
        key: item.id,
        label: item.data.name ?? 'Untitled database',
        icon: (iconProps: { class?: string }) => (
          <EntityIcon targetType="database" size="sm" class={iconProps.class} />
        ),
        selected: props.knob.value?.id === item.id,
        onSelect: () => {
          if (props.knob.value?.id !== item.id)
            props.onChange({ type: 'database', id: item.id });
        },
      }));
  return (
    <SearchMenu
      label={`${props.knob.label}: ${props.knob.value ? 'change it' : 'pick a database'}`}
      trigger={<KnobEntityValue knob={props.knob} />}
      triggerVariant="ghost"
      placeholder="Find a database"
      sections={[{ items: items() }]}
      empty="No databases found"
    />
  );
}
