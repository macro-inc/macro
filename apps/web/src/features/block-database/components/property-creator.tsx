import { Popover } from '@kobalte/core/popover';
import CaretDownIcon from '@phosphor/caret-down.svg';
import CheckIcon from '@phosphor/check.svg';
import PlusIcon from '@phosphor/plus.svg';
import XIcon from '@phosphor/x.svg';
import { Button } from '@ui/components/Button';
import { Dropdown } from '@ui/components/Dropdown';
import { createSignal, createUniqueId, For, Show } from 'solid-js';
import {
  DATABASE_PROPERTY_TYPES,
  type DatabasePropertyType,
  defaultDatabaseColumnName,
  isDatabaseNameTaken,
  parseDatabaseOptionLabels,
} from '../core/property-creation';
import { SelectPill } from './select-pill';

type CreateProperty = {
  name: string;
  dataType: DatabasePropertyType;
  inferType: boolean;
  options: string[];
};

export type PropertyCreatorVariant = 'outline' | 'ghost' | 'accent';

const STATUS_OPTIONS = ['Not started', 'In progress', 'Done'];

function PropertyForm(props: {
  existingNames: string[];
  initialType?: DatabasePropertyType;
  pending: boolean;
  onPendingChange: (pending: boolean) => void;
  onCreate: (property: CreateProperty) => Promise<void>;
  onClose: (created?: boolean) => void;
}) {
  const startsWithStatus = props.initialType === 'SELECT_STRING';
  const [name, setName] = createSignal(
    startsWithStatus && !isDatabaseNameTaken('Status', props.existingNames)
      ? 'Status'
      : ''
  );
  const [dataType, setDataType] = createSignal<DatabasePropertyType>(
    props.initialType ?? 'STRING'
  );
  const [inferType, setInferType] = createSignal(
    props.initialType === undefined
  );
  const [options, setOptions] = createSignal<string[]>(
    startsWithStatus ? STATUS_OPTIONS : []
  );
  const [optionDraft, setOptionDraft] = createSignal('');
  const pending = () => props.pending;
  const setPending = props.onPendingChange;
  const [error, setError] = createSignal('');
  const nameErrorId = createUniqueId();
  let optionInput: HTMLInputElement | undefined;
  const duplicate = () =>
    name().trim() && isDatabaseNameTaken(name(), props.existingNames);
  const allOptions = () =>
    parseDatabaseOptionLabels([...options(), optionDraft()].join('\n'));
  const invalidOptions = () =>
    dataType() === 'SELECT_STRING' &&
    allOptions().some((label) => label.length > 200);
  const valid = () =>
    !duplicate() && name().trim().length <= 200 && !invalidOptions();

  function chooseType(next: DatabasePropertyType) {
    setInferType(false);
    setDataType(next);
    if (
      next === 'SELECT_STRING' &&
      options().length === 0 &&
      !optionDraft().trim()
    )
      setOptions(STATUS_OPTIONS);
  }
  function addOption() {
    if (pending() || !optionDraft().trim() || invalidOptions()) return;
    setOptions(allOptions());
    setOptionDraft('');
    optionInput?.focus();
  }
  async function submit(event: SubmitEvent) {
    event.preventDefault();
    if (pending() || !valid()) return;
    setPending(true);
    setError('');
    try {
      await props.onCreate({
        name: name().trim() || defaultDatabaseColumnName(props.existingNames),
        dataType: dataType(),
        inferType: inferType(),
        options: dataType() === 'SELECT_STRING' ? allOptions() : [],
      });
      props.onClose(true);
    } catch {
      setError('Could not add this column. Please try again.');
    } finally {
      setPending(false);
    }
  }
  return (
    <form
      class="flex min-h-0 flex-col [&_button:focus-visible]:ring-2 [&_button:focus-visible]:ring-ink/50"
      style={{
        'max-height':
          'min(36rem, calc(var(--kb-popper-content-available-height, 100dvh) - 2px), calc(100dvh - 1rem - 2px))',
      }}
      onSubmit={submit}
    >
      <div class="shrink-0 px-3 pt-3">
        <Popover.Title class="text-sm font-semibold text-ink">
          New column
        </Popover.Title>
        <Popover.Description class="sr-only">
          Add a column to this table.
        </Popover.Description>
      </div>
      <div class="min-h-0 flex-1 overflow-auto overscroll-contain p-3">
        <fieldset
          disabled={pending()}
          class="flex min-w-0 flex-col gap-3 disabled:opacity-60"
        >
          <label class="flex flex-col gap-1.5 text-xs font-medium text-ink-muted">
            Column name
            <input
              maxlength={200}
              value={name()}
              onInput={(event) => setName(event.currentTarget.value)}
              placeholder="Unnamed"
              aria-label="Column name"
              aria-invalid={!!duplicate()}
              aria-describedby={duplicate() ? nameErrorId : undefined}
              class="h-9 rounded-md border border-edge-muted bg-input px-2.5 text-sm text-ink outline-none placeholder:text-ink-placeholder focus:border-ink/50"
            />
            <Show when={duplicate()}>
              <span id={nameErrorId} class="font-normal text-failure-ink">
                A column with this name already exists.
              </span>
            </Show>
          </label>
          <div class="flex items-center justify-between gap-3 text-xs text-ink-muted">
            <span>Type</span>
            <Dropdown
              placement="bottom-end"
              fitViewport
              overlap
              overflowPadding={8}
            >
              <Dropdown.Trigger
                variant="ghost"
                size="sm"
                aria-label={`Column type: ${DATABASE_PROPERTY_TYPES.find((item) => item.type === dataType())?.label}`}
                class="h-8 min-w-28 justify-between gap-3 px-2 text-xs"
              >
                {
                  DATABASE_PROPERTY_TYPES.find(
                    (item) => item.type === dataType()
                  )?.label
                }
                <CaretDownIcon class="size-3" />
              </Dropdown.Trigger>
              <Dropdown.Content
                portalScope="local"
                class="max-h-[var(--kb-popper-content-available-height)] min-w-40 overflow-y-auto text-xs"
              >
                <Dropdown.Group>
                  <Dropdown.RadioGroup value={dataType()}>
                    <For each={DATABASE_PROPERTY_TYPES}>
                      {(item) => (
                        <Dropdown.RadioItem
                          value={item.type}
                          closeOnSelect
                          onSelect={() => chooseType(item.type)}
                        >
                          <span class="flex-1">{item.label}</span>
                          <Dropdown.ItemIndicator>
                            <CheckIcon class="size-3.5" aria-hidden="true" />
                          </Dropdown.ItemIndicator>
                        </Dropdown.RadioItem>
                      )}
                    </For>
                  </Dropdown.RadioGroup>
                </Dropdown.Group>
              </Dropdown.Content>
            </Dropdown>
          </div>
          <Show when={dataType() === 'SELECT_STRING'}>
            <div>
              <p class="mb-2 text-xs font-medium text-ink-muted">Options</p>
              <div class="mb-2 flex flex-wrap gap-1.5">
                <For each={options()}>
                  {(option) => (
                    <span class="flex items-center gap-0.5 rounded-md bg-hover py-0.5 pl-0.5 pr-1">
                      <SelectPill label={option} />
                      <button
                        type="button"
                        aria-label={`Remove ${option} option`}
                        class="rounded p-0.5 text-ink-muted hover:bg-hover hover:text-ink"
                        onClick={() =>
                          setOptions((current) =>
                            current.filter((label) => label !== option)
                          )
                        }
                      >
                        <XIcon class="size-3" />
                      </button>
                    </span>
                  )}
                </For>
              </div>
              <div class="flex gap-2">
                <input
                  ref={optionInput}
                  aria-label="New option"
                  value={optionDraft()}
                  onInput={(event) => setOptionDraft(event.currentTarget.value)}
                  placeholder="Add an option…"
                  onKeyDown={(event) => {
                    if (event.isComposing || event.keyCode === 229) return;
                    if (event.key === 'Enter' && optionDraft().trim()) {
                      event.preventDefault();
                      addOption();
                    }
                  }}
                  class="h-9 min-w-0 flex-1 rounded-md border border-edge-muted bg-input px-2.5 text-sm text-ink outline-none placeholder:text-ink-placeholder focus:border-ink/50"
                />
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  disabled={!optionDraft().trim() || invalidOptions()}
                  onClick={addOption}
                >
                  <PlusIcon class="size-3.5" />
                  Add option
                </Button>
              </div>
              <Show when={invalidOptions()}>
                <p class="mt-2 text-xs text-failure-ink">
                  Use 200 characters or fewer for each option.
                </p>
              </Show>
            </div>
          </Show>
        </fieldset>
        <Show when={error()}>
          <p role="alert" class="mt-3 text-xs text-failure-ink">
            {error()}
          </p>
        </Show>
      </div>
      <div class="flex shrink-0 justify-end gap-2 border-t border-edge-muted p-3">
        <Button
          type="button"
          variant="ghost"
          disabled={pending()}
          onClick={() => props.onClose()}
        >
          Cancel
        </Button>
        <Button type="submit" variant="strong" disabled={pending() || !valid()}>
          {pending() ? 'Adding…' : 'Add column'}
        </Button>
      </div>
    </form>
  );
}

export function PropertyCreator(props: {
  existingNames: string[];
  label?: string;
  variant?: PropertyCreatorVariant;
  initialType?: DatabasePropertyType;
  onCreate: (property: CreateProperty) => Promise<void>;
  onCreated?: () => boolean;
}) {
  const [open, setOpen] = createSignal(false);
  const [pending, setPending] = createSignal(false);
  let created = false;
  return (
    <Popover
      open={open()}
      onOpenChange={(next) => {
        if (pending()) return;
        if (next) created = false;
        setOpen(next);
      }}
      placement="bottom-start"
      gutter={8}
      fitViewport
      overlap
      overflowPadding={8}
    >
      <Popover.Trigger
        as={Button}
        variant={props.variant ?? 'outline'}
        size="sm"
        class="gap-1.5 text-xs focus-visible:ring-2 focus-visible:ring-ink/50"
        disabled={pending()}
      >
        <PlusIcon class="size-3.5" />
        {props.label ?? 'Add column'}
      </Popover.Trigger>
      <Popover.Portal>
        <Popover.Content
          onCloseAutoFocus={(event) => {
            if (created && props.onCreated?.()) event.preventDefault();
            created = false;
          }}
          class="portal-scope z-action-menu w-80 max-w-[calc(100vw-1.5rem)] rounded-lg border border-edge bg-menu text-ink shadow-menu outline-none"
        >
          <PropertyForm
            existingNames={props.existingNames}
            initialType={props.initialType}
            pending={pending()}
            onPendingChange={setPending}
            onCreate={props.onCreate}
            onClose={(success) => {
              created = !!success;
              setOpen(false);
            }}
          />
        </Popover.Content>
      </Popover.Portal>
    </Popover>
  );
}
