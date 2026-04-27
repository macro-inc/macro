import { SegmentedControl } from '@core/component/FormControls/SegmentControls';
import { createMemo, createSignal, For, onMount, Show } from 'solid-js';
import { createBulkRenameDssEntityMutation } from '@macro-entity';
import { type EntityData, InlineEntity } from '@entity';
import { Dialog } from '@kobalte/core/dialog';
import { Button } from '@ui/components/Button';
import { cn } from '@ui/utils/classname';
import CloseIcon from '@phosphor-icons/core/regular/x.svg?component-solid';

type RenameMode = 'total' | 'prepend' | 'append' | 'replace';

export const BulkRenameEntitiesView = (props: {
  entities: EntityData[];
  onFinish: () => void;
  onCancel: () => void;
  onError?: (error: unknown) => void;
}) => {
  const renameMutation = createBulkRenameDssEntityMutation();

  let inputRef: HTMLInputElement | undefined;

  const primaryEntity = () => props.entities[0];
  const multi = () => props.entities.length > 1;

  const [editValue, setEditValue] = createSignal(primaryEntity()?.name ?? '');
  const [replaceFind, setReplaceFind] = createSignal('');
  const [replaceWith, setReplaceWith] = createSignal('');

  // Mode defaults
  const [mode, setMode] = createSignal<RenameMode>(
    multi() ? 'append' : 'total'
  );

  const modeOptions = [
    { value: 'prepend', label: 'Prepend' },
    { value: 'append', label: 'Append' },
    { value: 'replace', label: 'Replace' },
    { value: 'total', label: 'Total' },
  ];

  const handleKeyDown = (e: KeyboardEvent) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      finishEditing();
    } else if (e.key === 'Escape') {
      e.preventDefault();
      props.onCancel();
    }
  };

  const previewName = createMemo(() => {
    const base = primaryEntity()?.name ?? '';
    const v = editValue().trim();

    switch (mode()) {
      case 'total':
        return v;

      case 'prepend':
        return v + base;

      case 'append':
        return base + v;

      case 'replace':
        if (!replaceFind()) return base;
        return base.replaceAll(replaceFind(), replaceWith());

      default:
        return base;
    }
  });

  const finishEditing = async () => {
    const newValue = editValue();

    let renameFn: (old?: string) => string = () => newValue;
    switch (mode()) {
      case 'prepend':
        renameFn = (old: string) => newValue + old;
        break;
      case 'append':
        renameFn = (old: string) => old + newValue;
        break;
      case 'replace':
        renameFn = (old: string) =>
          old.replaceAll(replaceFind(), replaceWith());
        break;
      default:
    }

    try {
      await renameMutation.mutateAsync(
        props.entities.map((e) => ({ entity: e, newName: renameFn(e.name) }))
      );
      props.onFinish();
    } catch (error) {
      console.error('Failed to rename entities:', error);
      props.onError?.(error);
    }
  };

  return (
    <>
      <div class="shrink-0 flex flex-row items-center px-2 gap-1 border-b border-b-edge-muted h-10">
        <Dialog.CloseButton as={Button} variant="ghost" size="icon-sm">
          <CloseIcon />
        </Dialog.CloseButton>
        <Dialog.Title as="span" class="text-sm font-medium p-0 m-0">
          Rename
        </Dialog.Title>
      </div>

      <div class="p-2 border-b border-edge-muted">
        <div class="flex items-center gap-2">
          <For each={props.entities.slice(0, 2)}>
            {(entity) => (
              <div
                class={cn('bg-edge/20 px-2 py-1 truncate text-xs rounded-xs', {
                  'max-w-[50%]': props.entities.length === 2,
                })}
              >
                <InlineEntity entity={entity} />
              </div>
            )}
          </For>
          <Show when={props.entities.length > 2}>
            <div class="text-muted-foreground text-xs px-2 py-1">
              +{props.entities.length - 2} more
            </div>
          </Show>
        </div>
      </div>

      <div class="p-3 flex flex-col gap-3">
        <Show when={multi()}>
          <SegmentedControl
            label="Mode"
            value={mode()}
            list={modeOptions}
            onChange={(value) => setMode(value as RenameMode)}
            size="SM"
          />
        </Show>

        <div class="w-full focus-within:bracket-offset-2">
          <input
            ref={(el) => {
              inputRef = el;
              onMount(() => {
                setTimeout(() => {
                  inputRef?.focus();
                  inputRef?.select();
                });
              });
            }}
            value={editValue()}
            onInput={(e) => setEditValue(e.currentTarget.value)}
            onKeyDown={handleKeyDown}
            class="w-full p-2 text-sm border border-edge/20 bg-menu text-ink
                   placeholder:text-ink-placeholder focus:outline-none
                   selection:bg-ink selection:text-panel"
            placeholder="Enter new text..."
          />
        </div>

        <Show when={multi() && mode() === 'replace'}>
          <div class="flex flex-col gap-2">
            <input
              class="p-1 text-sm border border-edge/20 bg-menu"
              placeholder="Find…"
              value={replaceFind()}
              onInput={(e) => setReplaceFind(e.currentTarget.value)}
            />
            <input
              class="p-1 text-sm border border-edge/20 bg-menu"
              placeholder="Replace with…"
              value={replaceWith()}
              onInput={(e) => setReplaceWith(e.currentTarget.value)}
            />
          </div>
        </Show>

        <Show when={multi() && mode() !== 'total'}>
          <div class="text-xs opacity-70">
            Preview (first item):
            <div class="mt-1 p-2 bg-surface border border-edge/10 rounded">
              {previewName()}
            </div>
          </div>
        </Show>

        <div class="flex justify-end gap-2">
          <Button variant="ghost" class="rounded-xs" onClick={props.onCancel}>
            Cancel
          </Button>
          <Button
            type="button"
            variant="secondary"
            class="rounded-xs"
            onClick={finishEditing}
          >
            Rename
          </Button>
        </div>
      </div>
    </>
  );
};
