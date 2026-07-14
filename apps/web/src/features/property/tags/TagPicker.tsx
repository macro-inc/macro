import { Popover } from '@kobalte/core/popover';
import SearchIcon from '@phosphor/magnifying-glass.svg';
import PencilSimple from '@phosphor/pencil-simple.svg';
import Trash from '@phosphor/trash.svg';
import { useAddPropertyOptionMutation } from '@queries/properties/options';
import {
  invalidateTags,
  useDeletePropertyOptionMutation,
  useEnsureTagSetMutation,
  useUpdatePropertyOptionMutation,
} from '@queries/properties/tags';
import type { PropertyOptionResponse } from '@service-properties/generated/schemas/propertyOptionResponse';
import type { TagScope } from '@service-properties/generated/schemas/tagScope';
import { Button, cn, Dialog, Layer, SingleSelectCheck } from '@ui';
import {
  createMemo,
  createSignal,
  For,
  type JSX,
  Match,
  Show,
  Switch,
} from 'solid-js';
import { TagDot } from './TagDot';
import { DEFAULT_TAG_COLOR, TAG_COLORS } from './tagColors';
import type { useDocTags } from './useDocTags';

type DocTags = ReturnType<typeof useDocTags>;

function optionLabel(option: PropertyOptionResponse): string {
  return option.value.type === 'string' ? option.value.value : '';
}

function nextDisplayOrder(options: PropertyOptionResponse[]): number {
  return (
    options.reduce((max, option) => Math.max(max, option.displayOrder), -1) + 1
  );
}

// Bring a newly expanded row fully into view once it mounts so the bottom
// row's action buttons are never clipped below the scroll viewport. Deferred a
// frame so it runs after the expanded layout settles.
function scrollExpandedRowIntoView(el: HTMLElement) {
  requestAnimationFrame(() => el.scrollIntoView({ block: 'nearest' }));
}

function focusWithoutScroll(el: HTMLInputElement) {
  requestAnimationFrame(() => el.focus({ preventScroll: true }));
}

const SCOPE_LABEL: Record<TagScope, string> = {
  user: 'My labels',
  team: 'Team labels',
};

export function TagPicker(props: {
  docTags: DocTags;
  triggerClass?: string;
  triggerLabel: string;
  children: JSX.Element;
  onOpenChange?: (open: boolean) => void;
}) {
  const [open, setOpen] = createSignal(false);

  const handleOpenChange = (value: boolean) => {
    setOpen(value);
    props.onOpenChange?.(value);
  };

  return (
    <Popover
      open={open()}
      onOpenChange={handleOpenChange}
      placement="bottom-start"
      gutter={4}
    >
      <Popover.Trigger
        type="button"
        class={props.triggerClass}
        aria-label={props.triggerLabel}
      >
        {props.children}
      </Popover.Trigger>
      <TagPickerBody
        docTags={props.docTags}
        onClose={() => handleOpenChange(false)}
      />
    </Popover>
  );
}

/**
 * Trigger-less TagPicker anchored at an arbitrary point, for callers that
 * open the picker from somewhere else (e.g. a context-menu action).
 */
export function TagPickerPopover(props: {
  docTags: DocTags;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  getAnchorRect: () => { x: number; y: number } | undefined;
}) {
  return (
    <Popover
      open={props.open}
      onOpenChange={props.onOpenChange}
      getAnchorRect={props.getAnchorRect}
      placement="bottom-start"
      gutter={4}
    >
      <TagPickerBody
        docTags={props.docTags}
        onClose={() => props.onOpenChange(false)}
        // Focus starts outside the popover (the opener, e.g. a context menu,
        // is still tearing down when it mounts), so dismissing on
        // focus-outside would close it immediately. Pointer-down outside and
        // Escape still dismiss.
        dismissOnFocusOutside={false}
      />
    </Popover>
  );
}

function TagPickerBody(props: {
  docTags: DocTags;
  onClose: () => void;
  dismissOnFocusOutside?: boolean;
}) {
  const [search, setSearch] = createSignal('');
  const [createScope, setCreateScope] = createSignal<TagScope>('user');
  const [createColor, setCreateColor] = createSignal<string>(DEFAULT_TAG_COLOR);
  const [editingId, setEditingId] = createSignal<string | null>(null);

  const addOption = useAddPropertyOptionMutation();
  const ensureTagSet = useEnsureTagSetMutation();

  const hasTeamSet = createMemo(() =>
    props.docTags.tagSets().some((set) => set.scope === 'team')
  );

  const query = () => search().trim().toLowerCase();

  const filteredSet = (scope: TagScope): PropertyOptionResponse[] => {
    const set = props.docTags.tagSets().find((s) => s.scope === scope);
    if (!set) return [];
    const q = query();
    const options = q
      ? set.options.filter((option) =>
          optionLabel(option).toLowerCase().includes(q)
        )
      : set.options;
    return [...options].sort((a, b) => a.displayOrder - b.displayOrder);
  };

  const exactMatchExists = createMemo(() => {
    const q = search().trim().toLowerCase();
    if (!q) return false;
    return props.docTags
      .tagSets()
      .some((set) =>
        set.options.some((option) => optionLabel(option).toLowerCase() === q)
      );
  });

  const handleCreate = async () => {
    const value = search().trim();
    if (!value || exactMatchExists()) return;
    const scope = createScope();
    const provisioned = await ensureTagSet.mutateAsync({ scope });
    if (!provisioned.definition) return;
    const created = await addOption.mutateAsync({
      propertyDefinitionId: provisioned.definition.id,
      body: {
        type: 'select_string',
        option: {
          value,
          display_order: nextDisplayOrder(provisioned.options),
          color: createColor(),
        },
      },
    });
    invalidateTags();
    await props.docTags.applyTag(scope, created.id);
    setSearch('');
  };

  const closePicker = () => {
    setSearch('');
    setEditingId(null);
    props.onClose();
  };

  return (
    <Popover.Portal>
      <Layer depth={3}>
        <Popover.Content
          class="z-modal w-64 rounded-xl bg-surface text-sm shadow-lg ring ring-edge-muted"
          onCloseAutoFocus={(event) => event.preventDefault()}
          onFocusOutside={(event) => {
            if (props.dismissOnFocusOutside === false) event.preventDefault();
          }}
        >
          <div class="flex items-center gap-2 border-b border-edge-muted px-2 py-2">
            <SearchIcon class="size-4 text-ink-muted" />
            <input
              class="w-full bg-transparent caret-accent outline-none"
              value={search()}
              placeholder="Search or create label"
              onInput={(event) => setSearch(event.currentTarget.value)}
              onKeyDown={(event) => {
                if (event.key === 'Enter') {
                  event.preventDefault();
                  handleCreate();
                } else if (event.key === 'Escape') {
                  event.preventDefault();
                  closePicker();
                }
              }}
            />
          </div>

          <div class="max-h-72 scroll-pb-1.5 overflow-y-auto p-1.5">
            <For each={['user', 'team'] as const}>
              {(scope) => (
                <Show when={scope === 'user' || hasTeamSet()}>
                  <Show when={filteredSet(scope).length > 0}>
                    <div class="px-2 pb-1 pt-2 text-xs text-ink-extra-muted">
                      {SCOPE_LABEL[scope]}
                    </div>
                    <For each={filteredSet(scope)}>
                      {(option) => (
                        <TagPickerRow
                          scope={scope}
                          option={option}
                          docTags={props.docTags}
                          editing={editingId() === option.id}
                          onEdit={() => setEditingId(option.id)}
                          onEditClose={() => setEditingId(null)}
                        />
                      )}
                    </For>
                  </Show>
                </Show>
              )}
            </For>

            <Show when={search().trim() && !exactMatchExists()}>
              <CreateRow
                label={search().trim()}
                scope={createScope()}
                color={createColor()}
                hasTeamSet={hasTeamSet()}
                pending={addOption.isPending || ensureTagSet.isPending}
                onScope={setCreateScope}
                onColor={setCreateColor}
                onCreate={handleCreate}
                onCancel={() => setSearch('')}
              />
            </Show>

            <Show
              when={
                props.docTags
                  .tagSets()
                  .every((set) => set.options.length === 0) && !search().trim()
              }
            >
              <div class="px-2 py-4 text-center text-ink-muted">
                Type to create your first label
              </div>
            </Show>
          </div>
        </Popover.Content>
      </Layer>
    </Popover.Portal>
  );
}

function TagPickerRow(props: {
  scope: TagScope;
  option: PropertyOptionResponse;
  docTags: DocTags;
  editing: boolean;
  onEdit: () => void;
  onEditClose: () => void;
}) {
  const updateOption = useUpdatePropertyOptionMutation();
  const deleteOption = useDeletePropertyOptionMutation();
  const [confirmDelete, setConfirmDelete] = createSignal(false);
  const [draftLabel, setDraftLabel] = createSignal(optionLabel(props.option));
  const [draftColor, setDraftColor] = createSignal(
    props.option.color ?? DEFAULT_TAG_COLOR
  );

  const beginEdit = () => {
    setDraftLabel(optionLabel(props.option));
    setDraftColor(props.option.color ?? DEFAULT_TAG_COLOR);
    props.onEdit();
  };

  const saveEdit = async () => {
    const value = draftLabel().trim();
    await updateOption.mutateAsync({
      propertyDefinitionId: props.option.propertyDefinitionId,
      optionId: props.option.id,
      body: {
        value: value || undefined,
        color: draftColor(),
      },
    });
    props.onEditClose();
  };

  const handleDelete = async () => {
    await deleteOption.mutateAsync({
      propertyDefinitionId: props.option.propertyDefinitionId,
      optionId: props.option.id,
    });
    setConfirmDelete(false);
    props.onEditClose();
  };

  return (
    <Switch>
      <Match when={props.editing}>
        <div
          class="flex flex-col gap-2 rounded-lg bg-hover p-2"
          ref={scrollExpandedRowIntoView}
        >
          <div class="flex items-center gap-2">
            <TagDot color={draftColor()} />
            <input
              class="w-full bg-transparent caret-accent outline-none"
              value={draftLabel()}
              ref={focusWithoutScroll}
              onInput={(event) => setDraftLabel(event.currentTarget.value)}
              onKeyDown={(event) => {
                if (event.key === 'Enter') {
                  event.preventDefault();
                  saveEdit();
                }
              }}
            />
          </div>
          <ColorSwatchRow
            selected={draftColor()}
            onSelect={(color) => setDraftColor(color)}
          />
          <div class="flex items-center justify-between">
            <Button
              variant="ghost"
              size="sm"
              class="gap-1.5 text-failure-ink"
              onClick={() => setConfirmDelete(true)}
            >
              <Trash class="size-3.5" />
              Delete
            </Button>
            <div class="flex items-center gap-1.5">
              <Button variant="ghost" size="sm" onClick={props.onEditClose}>
                Cancel
              </Button>
              <Button
                variant="base"
                size="sm"
                onClick={saveEdit}
                disabled={updateOption.isPending}
              >
                Save
              </Button>
            </div>
          </div>
        </div>
        <DeleteConfirm
          open={confirmDelete()}
          label={optionLabel(props.option)}
          onCancel={() => setConfirmDelete(false)}
          onConfirm={handleDelete}
        />
      </Match>
      <Match when={!props.editing}>
        <div class="group flex items-center gap-2 rounded-lg p-1.5 hover:bg-hover">
          <button
            type="button"
            class="flex min-w-0 flex-1 items-center gap-2 text-left"
            onClick={() =>
              props.docTags.toggleTag(props.scope, props.option.id)
            }
          >
            <TagDot color={props.option.color ?? undefined} />
            <span class="min-w-0 flex-1 truncate">
              {optionLabel(props.option)}
            </span>
            <SingleSelectCheck
              active={props.docTags.isApplied(props.option.id)}
            />
          </button>
          <button
            type="button"
            class="shrink-0 rounded-md p-1 text-ink-muted opacity-0 hover:bg-active hover:text-ink group-hover:opacity-100"
            aria-label={`Edit ${optionLabel(props.option)}`}
            onClick={beginEdit}
          >
            <PencilSimple class="size-3.5" />
          </button>
        </div>
      </Match>
    </Switch>
  );
}

function CreateRow(props: {
  label: string;
  scope: TagScope;
  color: string;
  hasTeamSet: boolean;
  pending: boolean;
  onScope: (scope: TagScope) => void;
  onColor: (color: string) => void;
  onCreate: () => void;
  onCancel: () => void;
}) {
  return (
    <div
      class="mt-1 flex flex-col gap-2 rounded-lg border border-edge-muted p-2"
      ref={scrollExpandedRowIntoView}
    >
      <div class="flex items-center gap-2">
        <TagDot color={props.color} />
        <span class="min-w-0 flex-1 truncate">New label "{props.label}"</span>
      </div>
      <ColorSwatchRow selected={props.color} onSelect={props.onColor} />
      <Show when={props.hasTeamSet}>
        <div class="flex items-center gap-1">
          <For each={['user', 'team'] as const}>
            {(scope) => (
              <button
                type="button"
                class={cn(
                  'rounded-md px-2 py-0.5 text-xs',
                  props.scope === scope
                    ? 'bg-accent text-surface'
                    : 'text-ink-muted hover:bg-hover'
                )}
                onClick={() => props.onScope(scope)}
              >
                {scope === 'user' ? 'My label' : 'Team label'}
              </button>
            )}
          </For>
        </div>
      </Show>
      <div class="flex items-center justify-end gap-1.5">
        <Button variant="ghost" size="sm" onClick={props.onCancel}>
          Cancel
        </Button>
        <Button
          variant="base"
          size="sm"
          onClick={props.onCreate}
          disabled={props.pending}
        >
          Create
        </Button>
      </div>
    </div>
  );
}

function ColorSwatchRow(props: {
  selected: string;
  onSelect: (color: string) => void;
}) {
  return (
    <div class="flex flex-wrap items-center gap-1.5">
      <For each={TAG_COLORS}>
        {(color) => (
          <button
            type="button"
            class={cn(
              'size-4 rounded-full ring-offset-1 ring-offset-surface',
              props.selected === color ? 'ring-2 ring-ink' : 'ring-0'
            )}
            style={{ 'background-color': color }}
            aria-label={`Color ${color}`}
            onClick={() => props.onSelect(color)}
          />
        )}
      </For>
    </div>
  );
}

function DeleteConfirm(props: {
  open: boolean;
  label: string;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  return (
    <Dialog open={props.open} position="center" onOpenChange={props.onCancel}>
      <div class="rounded-xl bg-surface p-4 text-sm ring ring-edge-muted">
        <div class="text-ink">Delete label "{props.label}"?</div>
        <p class="mt-1 text-ink-muted">
          It will be removed from every item it's applied to.
        </p>
        <div class="mt-4 flex items-center justify-end gap-2">
          <Button variant="ghost" size="sm" onClick={props.onCancel}>
            Cancel
          </Button>
          <Button variant="danger" size="sm" onClick={props.onConfirm}>
            Delete
          </Button>
        </div>
      </div>
    </Dialog>
  );
}
