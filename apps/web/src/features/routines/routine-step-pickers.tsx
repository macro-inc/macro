import { Popover } from '@kobalte/core/popover';
import CaretDownIcon from '@phosphor/caret-down.svg';
import FolderIcon from '@phosphor/folder-simple.svg';
import HashIcon from '@phosphor/hash.svg';
import UserIcon from '@phosphor/user.svg';
import { useQuickAccessEntities } from '@property/editors/selectors/entityUtils';
import { PropertyEntitySelector } from '@property/editors/selectors/PropertyEntitySelector';
import { TagDot } from '@property/tags/TagDot';
import { badgeTriggerClasses, Dropdown } from '@ui';
import { createSignal, For, Match, Show, Suspense, Switch } from 'solid-js';
import {
  menuMount,
  type TagChoice,
  TextChoice,
} from './components/routine-tool-step';
import type { RoutineEditorSlots } from './context/routine-slots';
import { useEmailLabelNames, useRoutineTags } from './queries/step-sources';

function RoutineLabelPicker(props: {
  value: string;
  onChange(label: string): void;
}) {
  const names = useEmailLabelNames();
  return (
    <TextChoice
      label="Label"
      value={props.value}
      placeholder="Label name"
      suggestions={names()}
      onChange={props.onChange}
    />
  );
}

function RoutineTagPicker(props: {
  value: string | undefined;
  onChange(tag: TagChoice): void;
}) {
  const tags = useRoutineTags();
  const selected = () => tags().find((tag) => tag.optionId === props.value);
  let trigger: HTMLButtonElement | undefined;
  return (
    <Dropdown placement="bottom-start">
      <Dropdown.Trigger ref={trigger} aria-label="Tag" class="gap-1.5">
        <Show when={selected()} fallback="Choose a tag">
          {(tag) => (
            <>
              <TagDot color={tag().color} />
              {tag().label}
            </>
          )}
        </Show>
        <CaretDownIcon class="size-3" />
      </Dropdown.Trigger>
      <Dropdown.Content
        portalScope="local"
        mount={menuMount(trigger)}
        class="max-h-72 overflow-y-auto"
      >
        <Dropdown.Group>
          <Show
            when={tags().length}
            fallback={
              <p class="px-2 py-1.5 text-xs text-ink-muted">
                No tags yet. Create one from any item’s tags.
              </p>
            }
          >
            <For each={tags()}>
              {(tag) => (
                <Dropdown.Item
                  onSelect={() =>
                    props.onChange({
                      definitionId: tag.definitionId,
                      optionId: tag.optionId,
                      label: tag.label,
                    })
                  }
                >
                  <TagDot color={tag.color} />
                  <span class="flex-1">{tag.label}</span>
                  <Show when={tag.scope === 'team'}>
                    <span class="text-xs text-ink-extra-muted">Team</span>
                  </Show>
                </Dropdown.Item>
              )}
            </For>
          </Show>
        </Dropdown.Group>
      </Dropdown.Content>
    </Dropdown>
  );
}

/** A chip that opens an inline search for one channel, person or folder. */
function EntityPicker(props: {
  kind: 'CHANNEL' | 'USER' | 'PROJECT';
  value: string | undefined;
  placeholder: string;
  search: string;
  onChange(id: string, name: string): void;
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
      <Popover.Trigger
        ref={trigger}
        class={badgeTriggerClasses({ variant: 'outline', size: 'sm' })}
      >
        <Switch>
          <Match when={props.kind === 'CHANNEL'}>
            <HashIcon class="size-3.5" />
          </Match>
          <Match when={props.kind === 'USER'}>
            <UserIcon class="size-3.5" />
          </Match>
          <Match when={props.kind === 'PROJECT'}>
            <FolderIcon class="size-3.5" />
          </Match>
        </Switch>
        <span class="max-w-48 truncate">{label()}</span>
        <CaretDownIcon class="size-3" />
      </Popover.Trigger>
      <Popover.Portal mount={menuMount(trigger)}>
        <Popover.Content class="z-modal w-72 overflow-hidden rounded-xl border border-edge-muted bg-panel text-ink shadow-lg">
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
      placeholder="Choose a person"
      search="Search people…"
      onChange={props.onChange}
    />
  );
}

function RoutineFolderPicker(props: {
  value: string | undefined;
  onChange(projectId: string): void;
}) {
  return (
    <EntityPicker
      kind="PROJECT"
      value={props.value}
      placeholder="Choose a folder"
      search="Search folders…"
      onChange={(id) => props.onChange(id)}
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
