import {
  Button,
  Dialog,
  Input,
  type ManagedDialogProps,
  type OpenDialogOptions,
  openDialog,
  Surface,
} from '@ui';
import { createSignal, type JSX, Show } from 'solid-js';

export type LabelNameDialogProps = {
  title: string;
  /** Explains the label's scope, shown under the title. */
  body: JSX.Element;
  confirmLabel: string;
  initialValue?: string;
  placeholder?: string;
  onConfirm: (name: string) => Promise<void>;
};

/** Longest accepted label name; mirrors the backend limit. */
const MAX_LABEL_NAME_LENGTH = 80;

function LabelNameDialog(
  props: ManagedDialogProps &
    LabelNameDialogProps & { onSubmit: (name: string) => void }
) {
  const [value, setValue] = createSignal(props.initialValue ?? '');
  const [pending, setPending] = createSignal(false);
  const [error, setError] = createSignal('');
  const trimmed = () => value().trim();
  const canSubmit = () =>
    trimmed().length > 0 && trimmed() !== (props.initialValue ?? '').trim();

  const submit = async (event: Event) => {
    event.preventDefault();
    if (!canSubmit() || pending()) return;
    const name = trimmed();
    setPending(true);
    setError('');
    try {
      await props.onConfirm(name);
      props.onSubmit(name);
    } catch (error) {
      setError(
        error instanceof Error
          ? error.message
          : 'Could not save label. Please try again.'
      );
    } finally {
      setPending(false);
    }
  };

  return (
    <Dialog
      open={props.open}
      onOpenChange={(open) => {
        if (!pending()) props.onOpenChange(open);
      }}
      class="w-[90%] max-w-100"
      visibleScrim
    >
      <Surface depth={2} class="rounded-xl text-ink">
        <form onSubmit={(event) => void submit(event)} aria-busy={pending()}>
          <div class="flex flex-col gap-3 px-5 py-4">
            <div class="flex flex-col gap-1">
              <Dialog.Title class="text-base font-semibold">
                {props.title}
              </Dialog.Title>
              <Dialog.Description
                as="div"
                class="text-sm leading-5 text-ink-muted"
              >
                {props.body}
              </Dialog.Description>
            </div>
            <Input
              aria-label="Label name"
              readOnly={pending()}
              onFocus={(event) => event.currentTarget.select()}
              placeholder={props.placeholder ?? 'Label name'}
              value={value()}
              maxLength={MAX_LABEL_NAME_LENGTH}
              onInput={(event) => setValue(event.currentTarget.value)}
            />
            <Show when={error()}>
              <p role="alert" class="text-sm text-failure">
                {error()}
              </p>
            </Show>
          </div>
          <div class="flex items-center justify-end gap-2 px-5 py-3">
            <Button
              type="button"
              variant="ghost"
              depth={2}
              class="rounded-lg"
              disabled={pending()}
              onClick={() => props.onOpenChange(false)}
            >
              Cancel
            </Button>
            <Button
              type="submit"
              variant="accent"
              depth={2}
              class="rounded-lg"
              disabled={!canSubmit() || pending()}
            >
              {pending() ? 'Saving…' : props.confirmLabel}
            </Button>
          </div>
        </form>
      </Surface>
    </Dialog>
  );
}

/**
 * Ask for a label name in a dialog that explains who can see the label.
 * Resolves with the trimmed name, or `undefined` when dismissed.
 */
export async function promptLabelName(
  props: LabelNameDialogProps,
  options?: OpenDialogOptions
): Promise<string | undefined> {
  let result: string | undefined;

  const handle = openDialog(
    (managed: ManagedDialogProps & LabelNameDialogProps) => (
      <LabelNameDialog
        {...managed}
        onOpenChange={(open) => !open && managed.onOpenChange(false)}
        onSubmit={(name) => {
          result = name;
          managed.onOpenChange(false);
        }}
      />
    ),
    props,
    options
  );

  await handle.closed;
  return result;
}
