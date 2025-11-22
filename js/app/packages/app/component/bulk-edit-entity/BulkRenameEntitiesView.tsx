import type { EntityData } from '@macro-entity';
import { createSignal, onMount } from 'solid-js';
import { createBulkRenameDssEntityMutation } from '../../../macro-entity/src/queries/dss';
import {
  BulkEditEntityModalActionFooter,
  BulkEditEntityModalTitle,
} from './BulkEditEntityModal';

export const BulkRenameEntitiesView = (props: {
  entities: EntityData[];
  onFinish: () => void;
  onCancel: () => void;
}) => {
  const renameMutation = createBulkRenameDssEntityMutation();
  let inputRef: HTMLInputElement | undefined;

  const commonInitName = () => {
    const noDupes = new Set(props.entities.map((e) => e.name.trim()));

    if (noDupes.size > 1) return '';

    return Array.from(noDupes)[0] ?? '';
  };

  const [editValue, setEditValue] = createSignal(commonInitName());

  const handleKeyDown = (e: KeyboardEvent) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      finishEditing();
    } else if (e.key === 'Escape') {
      e.preventDefault();
      props.onCancel();
    }
  };

  const finishEditing = async () => {
    const newValue = editValue().trim();

    if (newValue) {
      // Todo - Bulk rename
      await renameMutation.mutateAsync({
        entities: props.entities,
        newName: newValue,
      });
    }

    props.onFinish();
  };

  return (
    <div class="w-full">
      <BulkEditEntityModalTitle title="Rename" />
      <div class="w-full focus-within:bracket-offset-2">
        <input
          ref={(el) => {
            inputRef = el;
            onMount(() => {
              // it needs to focus on next task, no idea why
              setTimeout(() => {
                inputRef?.focus();
                inputRef?.select();
              });
            });
          }}
          value={editValue()}
          onInput={(e) => setEditValue(e.currentTarget.value)}
          onKeyDown={handleKeyDown}
          class="w-full p-2 text-sm border-1 border-edge/20 bg-menu text-ink placeholder:text-ink-placeholder focus:outline-none selection:bg-ink selection:text-panel"
          placeholder="Enter title..."
        />
      </div>

      <BulkEditEntityModalActionFooter
        onCancel={props.onCancel}
        onConfirm={finishEditing}
        confirmText="Rename"
      />
    </div>
  );
};
