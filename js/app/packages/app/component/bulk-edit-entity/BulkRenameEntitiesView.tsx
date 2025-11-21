import { createMemo, createSignal, onMount, Show } from 'solid-js';
import { createBulkRenameDssEntityMutation } from '../../../macro-entity/src/queries/dss';
import type { EntityData } from '../../../macro-entity/src/types/entity';
import {
  BulkEditEntityModalActionFooter,
  BulkEditEntityModalTitle,
} from './BulkEditEntityModal';

type RenameMode = 'total' | 'prepend' | 'append' | 'replace';

export const BulkRenameEntitiesView = (props: {
  entities: EntityData[];
  onFinish: () => void;
  onCancel: () => void;
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

  const handleKeyDown = (e: KeyboardEvent) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      finishEditing();
    } else if (e.key === 'Escape') {
      e.preventDefault();
      props.onCancel();
    }
  };

  // --- Preview logic ---------------------------------------------------------

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

  // --- Finish Editing --------------------------------------------------------

  const finishEditing = async () => {
    const newValue = editValue().trim();

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

    // send mutation
    await renameMutation.mutateAsync({
      entities: props.entities,
      name: renameFn,
    });

    props.onFinish();
  };

  // --------------------------------------------------------------------------

  return (
    <div class="w-full">
      <BulkEditEntityModalTitle title="Rename" />

      <Show when={multi()}>
        <div class="mb-3 text-sm flex gap-2 items-center">
          <span class="opacity-70">Mode:</span>
          <select
            class="bg-menu border border-edge/20 p-1 rounded"
            value={mode()}
            onInput={(e) => setMode(e.currentTarget.value as RenameMode)}
          >
            <option value="prepend">Prepend</option>
            <option value="append">Append</option>
            <option value="replace">Replace</option>
            <option value="total">Total</option>
          </select>
        </div>
      </Show>

      <div class="w-full focus-within:bracket-offset-2 mb-3">
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
          class="w-full p-2 text-sm border-1 border-edge/20 bg-menu text-ink
                 placeholder:text-ink-placeholder focus:outline-none
                 selection:bg-ink selection:text-panel"
          placeholder="Enter new text..."
        />
      </div>

      {/* Extra inputs for replace mode */}
      <Show when={multi() && mode() === 'replace'}>
        <div class="flex flex-col gap-2 mb-4">
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

      {/* Preview */}
      <Show when={multi() && mode() !== 'total'}>
        <div class="text-xs opacity-70 mb-3">
          Preview (first item):
          <div class="mt-1 p-2 bg-surface border border-edge/10 rounded">
            {previewName()}
          </div>
        </div>
      </Show>

      <BulkEditEntityModalActionFooter
        onCancel={props.onCancel}
        onConfirm={finishEditing}
        confirmText="Rename"
      />
    </div>
  );
};
