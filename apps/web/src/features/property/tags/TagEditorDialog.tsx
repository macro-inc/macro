import { TabsInset } from '@core/component/TabsInset';
import TagIcon from '@phosphor/tag-simple.svg';
import TrashIcon from '@phosphor/trash.svg';
import XIcon from '@phosphor/x.svg';
import {
  type CreateTagResult,
  useCreateTagMutation,
  useDeletePropertyOptionMutation,
  useUpdatePropertyOptionMutation,
} from '@queries/properties/tags';
import type { PropertyOptionResponse } from '@service-properties/generated/schemas/propertyOptionResponse';
import type { TagScope } from '@service-properties/generated/schemas/tagScope';
import { Button, CommandMenuShell, cn, Dialog, Hotkey, Tooltip } from '@ui';
import type { JSX } from 'solid-js';
import { createEffect, createMemo, createSignal, For, Show } from 'solid-js';
import { TagDot } from './TagDot';
import { DEFAULT_TAG_COLOR, TAG_COLOR_OPTIONS } from './tagColors';

export type EditableTag = {
  scope: TagScope;
  propertyDefinitionId: string;
  option: PropertyOptionResponse;
};

export type TagEditorDialogMode =
  | {
      type: 'create';
      initialScope: TagScope;
      initialLabel?: string;
    }
  | {
      type: 'edit';
      tag: EditableTag;
    };

function optionLabel(option: PropertyOptionResponse): string {
  return option.value.type === 'string' ? option.value.value : '';
}

function initialColor(mode: TagEditorDialogMode): string {
  if (mode.type === 'create') return DEFAULT_TAG_COLOR;
  return mode.tag.option.color ?? DEFAULT_TAG_COLOR;
}

function initialLabel(mode: TagEditorDialogMode): string {
  return mode.type === 'create'
    ? (mode.initialLabel ?? '')
    : optionLabel(mode.tag.option);
}

function initialScope(mode: TagEditorDialogMode): TagScope {
  return mode.type === 'create' ? mode.initialScope : mode.tag.scope;
}

function EditorRow(props: { label: string; children: JSX.Element }) {
  return (
    <div class="flex min-h-12 items-center gap-5 px-4 py-3">
      <div class="w-22 shrink-0 text-xs font-medium text-ink-extra-muted">
        {props.label}
      </div>
      <div class="min-w-0 flex-1">{props.children}</div>
    </div>
  );
}

export function TagEditorDialog(props: {
  open: boolean;
  mode: TagEditorDialogMode | null;
  teamAvailable?: boolean;
  onCloseAutoFocus?: (event: Event) => void;
  onCreateSuccess?: (result: CreateTagResult) => void | Promise<void>;
  onClose: () => void;
}) {
  const [label, setLabel] = createSignal('');
  const [color, setColor] = createSignal(DEFAULT_TAG_COLOR);
  const [scope, setScope] = createSignal<TagScope>('user');
  const createTag = useCreateTagMutation();
  const updateTag = useUpdatePropertyOptionMutation();
  const deleteTag = useDeletePropertyOptionMutation();
  let nameInputRef: HTMLInputElement | undefined;

  createEffect(() => {
    const mode = props.mode;
    if (!props.open || !mode) return;
    setLabel(initialLabel(mode));
    setColor(initialColor(mode));
    setScope(
      mode.type === 'create' &&
        mode.initialScope === 'team' &&
        !props.teamAvailable
        ? 'user'
        : initialScope(mode)
    );

    if (mode.type === 'create') {
      requestAnimationFrame(() => {
        nameInputRef?.focus();
      });
    }
  });

  const title = () =>
    props.mode?.type === 'create' ? 'Create tag' : 'Edit tag';
  const pending = () =>
    createTag.isPending || updateTag.isPending || deleteTag.isPending;
  const trimmedLabel = () => label().trim();

  const dirty = createMemo(() => {
    const mode = props.mode;
    if (!mode) return false;
    if (mode.type === 'create') return trimmedLabel().length > 0;

    return (
      trimmedLabel() !== initialLabel(mode) || color() !== initialColor(mode)
    );
  });

  const canSubmit = () => !!props.mode && trimmedLabel().length > 0 && dirty();

  const close = () => {
    if (pending()) return;
    props.onClose();
  };

  const submit = () => {
    const mode = props.mode;
    const value = trimmedLabel();
    if (!mode || !value || pending()) return;

    if (mode.type === 'create') {
      createTag.mutate(
        { scope: scope(), value, color: color() },
        {
          onSuccess: async (result) => {
            await props.onCreateSuccess?.(result);
            props.onClose();
          },
        }
      );
      return;
    }

    const body: {
      value?: string;
      color?: string;
    } = {};

    if (value !== initialLabel(mode)) body.value = value;
    if (color() !== initialColor(mode)) body.color = color();

    updateTag.mutate(
      {
        propertyDefinitionId: mode.tag.propertyDefinitionId,
        optionId: mode.tag.option.id,
        body,
      },
      { onSuccess: props.onClose }
    );
  };

  const remove = () => {
    const mode = props.mode;
    if (!mode || mode.type !== 'edit' || pending()) return;

    deleteTag.mutate(
      {
        propertyDefinitionId: mode.tag.propertyDefinitionId,
        optionId: mode.tag.option.id,
      },
      { onSuccess: props.onClose }
    );
  };

  const handleKeyDown = (event: KeyboardEvent) => {
    if ((event.metaKey || event.ctrlKey) && event.key === 'Enter') {
      event.preventDefault();
      if (canSubmit()) submit();
    }
  };

  return (
    <Dialog
      open={props.open}
      onOpenChange={(open) => !open && close()}
      onCloseAutoFocus={props.onCloseAutoFocus}
    >
      <CommandMenuShell depth={2} class="text-sm" onKeyDown={handleKeyDown}>
        <CommandMenuShell.Header class="my-0 h-13 gap-3 border-b-0 px-4">
          <span class="text-ink-muted">
            <TagIcon class="size-3.5" />
          </span>
          <Dialog.Title
            as="span"
            class="min-w-0 flex-1 truncate text-sm font-semibold text-ink-extra-muted"
          >
            {title()}
          </Dialog.Title>
          <Dialog.CloseButton
            as={Button}
            variant="ghost"
            size="icon-sm"
            disabled={pending()}
            label="Close"
          >
            <XIcon />
          </Dialog.CloseButton>
        </CommandMenuShell.Header>
        <CommandMenuShell.Body>
          <div class="bg-surface">
            <EditorRow label="Name">
              <input
                ref={nameInputRef}
                autofocus={props.mode?.type === 'create'}
                value={label()}
                onInput={(event) => setLabel(event.currentTarget.value)}
                onKeyDown={(event) => {
                  if (event.key === 'Enter' && canSubmit()) submit();
                }}
                class="h-9 w-full rounded-md border border-edge-muted bg-surface px-3 text-sm text-ink outline-none placeholder:text-ink-placeholder focus:border-accent"
                placeholder="Tag name"
              />
            </EditorRow>

            <EditorRow label="Color">
              <div class="flex flex-wrap items-center gap-2">
                <For each={TAG_COLOR_OPTIONS}>
                  {(option) => (
                    <Tooltip label={option.name}>
                      <button
                        type="button"
                        aria-label={option.name}
                        onClick={() => setColor(option.color)}
                        class={cn(
                          'flex size-7 items-center justify-center rounded-md border outline-none hover:bg-hover focus-visible:border-accent',
                          color() === option.color
                            ? 'border-accent bg-accent-bg'
                            : 'border-edge-muted'
                        )}
                      >
                        <TagDot color={option.color} class="size-3.5" />
                      </button>
                    </Tooltip>
                  )}
                </For>
              </div>
            </EditorRow>

            <Show when={props.mode?.type === 'create'}>
              <EditorRow label="Sharing">
                <TabsInset
                  depth={0}
                  list={[
                    { value: 'team', label: 'Team' },
                    { value: 'user', label: 'Personal' },
                  ]}
                  value={scope()}
                  onChange={(value) => {
                    if (value === 'team' && !props.teamAvailable) return;
                    if (value === 'team' || value === 'user') {
                      setScope(value);
                    }
                  }}
                />
              </EditorRow>
            </Show>
          </div>
        </CommandMenuShell.Body>
        <CommandMenuShell.Footer class="gap-2 border-t-0 py-3">
          <Show when={props.mode?.type === 'edit'}>
            <Button
              variant="danger"
              size="sm"
              class="rounded-lg"
              disabled={pending()}
              onClick={remove}
            >
              <TrashIcon class="size-4" />
              Delete
            </Button>
          </Show>
          <div class="ml-auto flex items-center gap-2">
            <Button
              variant="ghost"
              size="sm"
              class="rounded-lg"
              disabled={pending()}
              onClick={close}
            >
              Cancel
            </Button>
            <Button
              variant={canSubmit() ? 'accent' : 'ghost'}
              depth={3}
              class="gap-3 rounded-lg border-0"
              disabled={!canSubmit() || pending()}
              onClick={submit}
            >
              Save
              <Hotkey shortcut="cmd+enter" theme="current" />
            </Button>
          </div>
        </CommandMenuShell.Footer>
      </CommandMenuShell>
    </Dialog>
  );
}
