import { Tooltip } from '@ui/components/Tooltip';
import { createSignal, onMount, Show } from 'solid-js';

function TitleEditor(props: {
  name: string;
  onRename: (name: string) => Promise<void>;
  onClose: (intent: 'confirm' | 'cancel' | 'blur') => void;
}) {
  const [draft, setDraft] = createSignal(props.name);
  const [pending, setPending] = createSignal(false);
  const [error, setError] = createSignal('');
  let input!: HTMLInputElement;
  let form!: HTMLFormElement;
  let closed = false;
  const close = (intent: 'confirm' | 'cancel' | 'blur') => {
    closed = true;
    props.onClose(intent);
  };
  const save = async (intent: 'confirm' | 'blur' = 'blur') => {
    if (pending() || closed) return;
    const name = draft().trim();
    if (!name) {
      setError('Enter a name for this database.');
      return;
    }
    if (name === props.name) {
      close(
        intent === 'confirm' && document.activeElement !== input
          ? 'blur'
          : intent
      );
      return;
    }
    setPending(true);
    setError('');
    try {
      await props.onRename(name);
      close(
        intent === 'confirm' && document.activeElement !== input
          ? 'blur'
          : intent
      );
    } catch {
      setError('Could not save the name. Try again.');
    } finally {
      setPending(false);
    }
  };
  onMount(() => {
    input.focus();
    input.select();
  });
  return (
    <form
      ref={form}
      class="flex min-w-0 flex-col gap-1"
      onSubmit={(event) => {
        event.preventDefault();
        void save('confirm');
      }}
      onFocusOut={(event) => {
        // Focus changes inside the title editor do not end its edit session.
        if (
          event.relatedTarget instanceof Node &&
          form.contains(event.relatedTarget)
        )
          return;
        void save();
      }}
    >
      <div class="flex min-w-0 items-center gap-1">
        <input
          ref={input}
          aria-label="Database name"
          aria-invalid={!!error()}
          maxlength={200}
          value={draft()}
          readOnly={pending()}
          onInput={(event) => {
            setDraft(event.currentTarget.value);
            setError('');
          }}
          onKeyDown={(event) => {
            if (event.isComposing || event.keyCode === 229) return;
            if (event.key === 'Escape' && !pending()) {
              event.preventDefault();
              event.stopPropagation();
              close('cancel');
            }
            if (event.key === 'Enter') {
              event.preventDefault();
              void save('confirm');
            }
          }}
          class="h-8 min-w-0 flex-1 rounded-md border border-ink/30 bg-input px-1.5 text-lg font-semibold tracking-tight text-ink outline-none disabled:opacity-60"
        />
      </div>
      <Show when={error()}>
        <p role="alert" class="text-xs text-failure">
          {error()}
        </p>
      </Show>
    </form>
  );
}

/** The host owns persistence. A failed rename keeps the user's draft editable. */
export function DatabaseTitle(props: {
  name: string;
  canEdit: boolean;
  autoFocus?: boolean;
  onConfirm?: () => void;
  onRename: (name: string) => Promise<void>;
}) {
  const [editing, setEditing] = createSignal(
    !!props.autoFocus && props.canEdit
  );
  let titleButton: HTMLButtonElement | undefined;
  return (
    <Show
      when={editing() && props.canEdit}
      fallback={
        <h1 class="min-w-0 text-lg font-semibold tracking-tight text-ink">
          <Tooltip
            class="min-w-0 max-w-full"
            label={props.canEdit ? `Rename ${props.name}` : props.name}
          >
            <button
              ref={titleButton}
              type="button"
              disabled={!props.canEdit}
              aria-label={
                props.canEdit ? `Rename database: ${props.name}` : undefined
              }
              onClick={() => setEditing(true)}
              class="group flex max-w-full min-w-0 items-center gap-1.5 rounded-md text-left outline-none focus-visible:ring-2 focus-visible:ring-ink/25 disabled:opacity-100"
            >
              <span class="truncate">{props.name}</span>
            </button>
          </Tooltip>
        </h1>
      }
    >
      <TitleEditor
        name={props.name}
        onRename={props.onRename}
        onClose={(intent) => {
          setEditing(false);
          if (intent === 'confirm' && props.onConfirm)
            queueMicrotask(props.onConfirm);
          else if (intent !== 'blur')
            queueMicrotask(() => titleButton?.focus());
        }}
      />
    </Show>
  );
}
