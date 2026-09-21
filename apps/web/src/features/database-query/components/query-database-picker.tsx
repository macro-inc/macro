import { Combobox } from '@kobalte/core/combobox';
import { Popover } from '@kobalte/core/popover';
import CaretDownIcon from '@phosphor/caret-down.svg';
import CheckIcon from '@phosphor/check.svg';
import DatabaseIcon from '@phosphor/database.svg';
import SearchIcon from '@phosphor/magnifying-glass.svg';
import SparkleIcon from '@phosphor/sparkle.svg';
import { Tooltip } from '@ui/components/Tooltip';
import { createSignal, Show } from 'solid-js';

type DatabaseChoice = { id: string; name: string };
const AUTOMATIC: DatabaseChoice = { id: '', name: 'Automatic' };

export function QueryDatabasePicker(props: {
  databases: DatabaseChoice[];
  /** No explicit id means AI chooses from the accessible databases. */
  value?: string;
  resolvedName?: string;
  loading?: boolean;
  disabled?: boolean;
  onChange: (id: string | undefined) => void;
}) {
  const [open, setOpen] = createSignal(false);
  const name = () =>
    props.value
      ? (props.databases.find((database) => database.id === props.value)
          ?.name ??
        props.resolvedName ??
        (props.loading ? 'Loading…' : 'Database unavailable'))
      : (props.resolvedName ?? 'Automatic');
  const description = () =>
    props.value
      ? `${name()} · All tables`
      : props.resolvedName
        ? `${name()} · Chosen automatically`
        : 'Let AI choose a database';

  return (
    <Popover
      open={open()}
      onOpenChange={setOpen}
      placement="bottom-start"
      gutter={6}
      fitViewport
      overlap
      overflowPadding={8}
    >
      <Tooltip
        as="span"
        label={description()}
        disabled={open()}
        class="min-w-0 max-w-full"
      >
        <Popover.Trigger
          disabled={props.disabled}
          aria-label={`Database: ${name()}${!props.value && props.resolvedName ? ' (automatic)' : ''}`}
          class="flex h-7 min-w-0 max-w-full items-center gap-1.5 rounded-md px-1.5 text-xs text-ink-muted outline-none hover:bg-hover hover:text-ink focus-visible:ring-2 focus-visible:ring-ink/50 disabled:opacity-40 data-expanded:bg-hover"
        >
          <Show
            when={props.value}
            fallback={<SparkleIcon class="size-3.5 shrink-0" />}
          >
            <DatabaseIcon class="size-3.5 shrink-0" />
          </Show>
          <span class="truncate">{name()}</span>
          <CaretDownIcon class="size-3 shrink-0" />
        </Popover.Trigger>
      </Tooltip>
      <Popover.Portal>
        <Popover.Content
          class="z-action-menu flex w-72 max-w-[calc(100vw-1rem)] min-h-0 flex-col rounded-lg border border-edge bg-menu text-ink shadow-menu outline-none"
          style={{
            'max-height':
              'min(24rem, var(--kb-popper-content-available-height, calc(100dvh - 1rem)), calc(100dvh - 1rem))',
          }}
        >
          <Popover.Title class="sr-only">Choose database</Popover.Title>
          <DatabaseChoices
            databases={props.databases}
            value={props.value}
            loading={props.loading}
            onClose={() => setOpen(false)}
            onChange={(id) => {
              props.onChange(id);
              setOpen(false);
            }}
          />
        </Popover.Content>
      </Popover.Portal>
    </Popover>
  );
}

function DatabaseChoices(props: {
  databases: DatabaseChoice[];
  value?: string;
  loading?: boolean;
  onChange: (id: string | undefined) => void;
  onClose: () => void;
}) {
  const [search, setSearch] = createSignal('');
  const choices = () => [AUTOMATIC, ...props.databases];
  const matching = () =>
    choices().filter((choice) =>
      choice.name
        .toLocaleLowerCase()
        .includes(search().trim().toLocaleLowerCase())
    );
  return (
    <Combobox<DatabaseChoice>
      open
      onOpenChange={(isOpen) => {
        if (!isOpen) props.onClose();
      }}
      options={choices()}
      value={
        choices().find((choice) => choice.id === (props.value ?? '')) ?? null
      }
      optionValue="id"
      optionTextValue="name"
      optionLabel={() => ''}
      allowsEmptyCollection
      allowDuplicateSelectionEvents
      disallowEmptySelection
      closeOnSelection={false}
      defaultFilter="contains"
      onInputChange={setSearch}
      onChange={(choice) => {
        if (choice) props.onChange(choice.id || undefined);
      }}
      class="flex min-h-0 flex-col"
      itemComponent={({ item }) => (
        <Combobox.Item
          item={item}
          class="flex min-w-0 items-center gap-2 rounded-md px-2 py-2 text-sm outline-none data-highlighted:bg-hover"
        >
          <Show
            when={item.rawValue.id}
            fallback={<SparkleIcon class="size-4 shrink-0 text-ink-muted" />}
          >
            <DatabaseIcon class="size-4 shrink-0 text-ink-muted" />
          </Show>
          <Combobox.ItemLabel
            class="min-w-0 flex-1 truncate"
            title={item.rawValue.name}
          >
            {item.rawValue.name}
          </Combobox.ItemLabel>
          <Show when={!item.rawValue.id}>
            <span class="shrink-0 text-xs text-ink-muted">AI chooses</span>
          </Show>
          <Combobox.ItemIndicator class="flex size-4 shrink-0 items-center">
            <CheckIcon class="size-3.5" />
          </Combobox.ItemIndicator>
        </Combobox.Item>
      )}
    >
      <div class="flex shrink-0 items-center gap-2 border-b border-edge-muted px-3 py-2">
        <SearchIcon class="size-3.5 shrink-0 text-ink-muted" />
        <Combobox.Input
          aria-label="Search databases"
          placeholder="Find a database…"
          class="h-7 min-w-0 flex-1 bg-transparent text-sm outline-none placeholder:text-ink-placeholder"
          onKeyDown={(event) => {
            if (event.key !== 'Tab') event.stopPropagation();
          }}
        />
      </div>
      <Combobox.Listbox
        aria-label="Databases"
        class="min-h-0 max-h-64 overflow-y-auto overscroll-contain p-1"
      />
      <Show when={props.loading}>
        <p role="status" class="px-3 py-2 text-xs text-ink-muted">
          Loading databases…
        </p>
      </Show>
      <Show when={!matching().length && !props.loading}>
        <p role="status" class="px-3 py-4 text-center text-xs text-ink-muted">
          No databases found
        </p>
      </Show>
    </Combobox>
  );
}
