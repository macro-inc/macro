import { createSignal, Show } from 'solid-js';
import type {
  DatabaseEntityType,
  DatabaseMention,
} from '../../database/core/column-inference';
import { CreateContactModal } from './create-contact';

/**
 * A pipeline contact cell can create the person it was searching for.
 * The dialog stays mounted after the cell's menu closes.
 */
export function usePipelineContactCellCreate() {
  const [name, setName] = createSignal<string>();
  let select: ((mention: DatabaseMention) => void) | undefined;
  return {
    forCell(
      entityType: DatabaseEntityType | undefined,
      onSelect: (mention: DatabaseMention) => void
    ) {
      if (entityType !== 'CONTACT') return undefined;
      return (search: string) => {
        select = onSelect;
        setName(search);
      };
    },
    dialog() {
      return (
        <Show when={name()} keyed>
          {(draft) => (
            <CreateContactModal
              target={{}}
              initialName={draft}
              onClose={() => {
                setName(undefined);
                // Success reads `select` synchronously, before this microtask.
                queueMicrotask(() => {
                  select = undefined;
                });
              }}
              onCreated={(id, createdName) => {
                const chosen = select;
                select = undefined;
                chosen?.({
                  id,
                  entityType: 'CONTACT',
                  label: createdName,
                });
              }}
            />
          )}
        </Show>
      );
    },
  };
}
