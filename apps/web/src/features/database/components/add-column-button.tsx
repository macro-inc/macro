import PlusIcon from '@phosphor/plus.svg';
import { Button } from '@ui/components/Button';
import { createSignal, Show } from 'solid-js';
import {
  type CreateDatabaseColumn,
  columnSchemaMessage,
} from '../core/column-schema';

/** Shared add-column control; the host owns schema persistence. */
export function AddColumnButton(props: {
  create: CreateDatabaseColumn;
  label?: string;
  onCreated?: (columnId: string) => boolean;
}) {
  const [pending, setPending] = createSignal(false);
  const [error, setError] = createSignal('');
  async function add() {
    if (pending()) return;
    setPending(true);
    setError('');
    let announced = false;
    const created = await props.create((id) => {
      announced = true;
      props.onCreated?.(id);
    });
    setPending(false);
    created.match(
      (id) => {
        if (!announced) props.onCreated?.(id);
      },
      (error) => setError(columnSchemaMessage(error))
    );
  }
  return (
    <div class="relative">
      <Button
        variant="ghost"
        size="sm"
        disabled={pending()}
        aria-label={props.label ?? 'Add column'}
        onClick={() => void add()}
      >
        <PlusIcon class="size-3.5" />
        {props.label ?? 'Add column'}
      </Button>
      <Show when={error()}>
        <span
          role="alert"
          class="absolute top-full right-0 z-2 w-52 rounded-md border border-edge-muted bg-panel p-2 text-xs text-failure-ink shadow-md"
        >
          {error()}
        </span>
      </Show>
    </div>
  );
}
