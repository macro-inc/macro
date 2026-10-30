import CaretDownIcon from '@icon/system/regular/caret-down.svg';
import FolderIcon from '@icon/system/regular/folder-simple.svg';
import HashIcon from '@icon/system/regular/hash.svg';
import PlusIcon from '@icon/system/regular/plus.svg';
import TagIcon from '@icon/system/regular/tag.svg';
import UserIcon from '@icon/system/regular/user.svg';
import { Popover } from '@kobalte/core/popover';
import { useQuickAccessEntities } from '@property/editors/selectors/entityUtils';
import { PropertyEntitySelector } from '@property/editors/selectors/PropertyEntitySelector';
import { TagDot } from '@property/tags/TagDot';
import { Button } from '@ui';
import {
  createSignal,
  Match,
  Show,
  Suspense,
  Switch,
  type ValidComponent,
} from 'solid-js';
import { SearchMenu } from './components/routine-search-menu';
import { menuMount, type TagChoice } from './components/routine-tool-step';
import type { RoutineEditorSlots } from './context/routine-slots';
import { useEmailLabelNames, useRoutineTags } from './queries/step-sources';

/** A token's caret, after its value. */
function Caret() {
  return <CaretDownIcon class="size-3 shrink-0 text-ink-muted" />;
}

/** Gmail labels by name, so a step works in each email's own inbox. */
function RoutineLabelPicker(props: {
  value: string;
  onChange(label: string): void;
}) {
  const names = useEmailLabelNames();
  return (
    <SearchMenu
      label="Label"
      triggerVariant={props.value ? 'secondary' : 'outline'}
      triggerClass="max-w-full gap-1.5"
      trigger={
        <>
          <TagIcon class="size-3.5 shrink-0 text-ink-muted" />
          <span class="truncate">{props.value || 'Choose a label'}</span>
          <Caret />
        </>
      }
      placeholder="Search labels"
      sections={[
        {
          items: names().map((name) => ({
            key: name,
            label: name,
            icon: TagIcon,
            selected: name === props.value,
            onSelect: () => props.onChange(name),
          })),
        },
      ]}
      fromQuery={(query) =>
        names().some((name) => name.toLowerCase() === query.toLowerCase())
          ? undefined
          : {
              key: `use:${query}`,
              label: `Use “${query}”`,
              icon: PlusIcon,
              onSelect: () => props.onChange(query),
            }
      }
      empty="No labels yet. Type a label’s name."
    />
  );
}

function RoutineTagPicker(props: {
  value: string | undefined;
  onChange(tag: TagChoice): void;
}) {
  const tags = useRoutineTags();
  const selected = () => tags().find((tag) => tag.optionId === props.value);
  return (
    <SearchMenu
      label="Tag"
      triggerVariant={selected() ? 'secondary' : 'outline'}
      triggerClass="max-w-full gap-1.5"
      trigger={
        <Show
          when={selected()}
          fallback={
            <>
              Choose a tag
              <Caret />
            </>
          }
        >
          {(tag) => (
            <>
              <TagDot color={tag().color} />
              <span class="truncate">{tag().label}</span>
              <Caret />
            </>
          )}
        </Show>
      }
      placeholder="Search tags"
      sections={[
        {
          items: tags().map((tag) => ({
            key: tag.optionId,
            label: tag.label,
            swatch: <TagDot color={tag.color} />,
            hint: tag.scope === 'team' ? 'Team' : undefined,
            selected: tag.optionId === props.value,
            onSelect: () =>
              props.onChange({
                definitionId: tag.definitionId,
                optionId: tag.optionId,
                label: tag.label,
              }),
          })),
        },
      ]}
      empty="No tags yet. Create one from any item’s tags."
    />
  );
}

/** A token that opens an inline search for one channel, person or folder. */
function EntityPicker(props: {
  kind: 'CHANNEL' | 'USER' | 'PROJECT';
  value: string | undefined;
  placeholder: string;
  search: string;
  onChange(id: string, name: string): void;
  /** Where choosing nothing is allowed, e.g. an optional folder. */
  onClear?(): void;
}) {
  const [open, setOpen] = createSignal(false);
  let trigger: HTMLButtonElement | undefined;
  const entities = useQuickAccessEntities(() => props.kind);
  const name = (id: string) =>
    entities.items().find((item) => item.id === id)?.data.name ??
    id.replace(/^macro\|/, '');
  const label = () => (props.value ? name(props.value) : props.placeholder);
  return (
    <Popover open={open()} onOpenChange={setOpen} placement="bottom-start">
      <Popover.Trigger<ValidComponent>
        as={Button}
        ref={trigger}
        variant={props.value ? 'secondary' : 'outline'}
        size="sm"
        class="max-w-full gap-1.5"
      >
        <Switch>
          <Match when={props.kind === 'CHANNEL'}>
            <HashIcon class="size-3.5 shrink-0 text-ink-muted" />
          </Match>
          <Match when={props.kind === 'USER'}>
            <UserIcon class="size-3.5 shrink-0 text-ink-muted" />
          </Match>
          <Match when={props.kind === 'PROJECT'}>
            <FolderIcon class="size-3.5 shrink-0 text-ink-muted" />
          </Match>
        </Switch>
        <span class="max-w-48 truncate">{label()}</span>
        <Caret />
      </Popover.Trigger>
      <Popover.Portal mount={menuMount(trigger)}>
        <Popover.Content class="menu-surface z-action-menu w-72 overflow-hidden rounded-xl text-ink outline-none">
          <Suspense
            fallback={<p class="p-3 text-sm text-ink-muted">Loading…</p>}
          >
            <PropertyEntitySelector
              config={{
                isMultiSelect: false,
                placeholder: props.search,
                specificEntityType: props.kind,
              }}
              selectedOptions={() => new Set(props.value ? [props.value] : [])}
              setSelectedOptions={(ids) => {
                const [id] = [...ids];
                if (id) props.onChange(id, name(id));
                else props.onClear?.();
                setOpen(false);
              }}
            />
          </Suspense>
        </Popover.Content>
      </Popover.Portal>
    </Popover>
  );
}

function RoutineChannelPicker(props: {
  value: string;
  onChange(channelId: string): void;
}) {
  return (
    <EntityPicker
      kind="CHANNEL"
      value={props.value || undefined}
      placeholder="Choose a channel"
      search="Search channels…"
      onChange={(id) => props.onChange(id)}
    />
  );
}

function RoutineAssigneePicker(props: {
  value: string | undefined;
  onChange(entityId: string, name: string): void;
}) {
  return (
    <EntityPicker
      kind="USER"
      value={props.value}
      placeholder="Person"
      search="Search people…"
      onChange={props.onChange}
    />
  );
}

function RoutineFolderPicker(props: {
  value: string | undefined;
  onChange(projectId: string | undefined): void;
}) {
  return (
    <EntityPicker
      kind="PROJECT"
      value={props.value}
      placeholder="None"
      search="Search folders…"
      onChange={(id) => props.onChange(id)}
      onClear={() => props.onChange(undefined)}
    />
  );
}

/** Production pickers for routine tool steps. */
export const routineToolSlots: Pick<
  RoutineEditorSlots,
  | 'LabelPicker'
  | 'TagPicker'
  | 'ChannelPicker'
  | 'AssigneePicker'
  | 'FolderPicker'
> = {
  LabelPicker: RoutineLabelPicker,
  TagPicker: RoutineTagPicker,
  ChannelPicker: RoutineChannelPicker,
  AssigneePicker: RoutineAssigneePicker,
  FolderPicker: RoutineFolderPicker,
};
