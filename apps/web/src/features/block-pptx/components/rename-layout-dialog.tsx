/**
 * Slide Master ▸ Rename: PowerPoint's Rename Layout (or Rename Master)
 * dialog, one name field with Rename and Cancel.
 */

import X from '@phosphor/x.svg';
import { Button } from '@ui/components/Button';
import { Dialog } from '@ui/components/Dialog';
import { inputClasses } from '@ui/components/Input';

export function RenameLayoutDialog(props: {
  /** Whether a master (not a layout) is renamed. */
  master: boolean;
  name: string;
  onRename: (name: string) => void;
  onClose: () => void;
}) {
  let input!: HTMLInputElement;
  const what = () => (props.master ? 'Master' : 'Layout');
  const submit = (e: SubmitEvent) => {
    e.preventDefault();
    const name = input.value.trim();
    if (!name) return;
    props.onRename(name);
    props.onClose();
  };
  return (
    <Dialog
      open
      onOpenChange={(open) => !open && props.onClose()}
      class="w-[min(360px,94vw)]"
    >
      <form
        class="relative flex flex-col gap-4 p-4"
        data-testid="pptx-rename-layout-dialog"
        onSubmit={submit}
      >
        <h2 class="font-semibold text-ink text-sm">Rename {what()}</h2>
        <label class="flex flex-col gap-1 text-ink text-sm">
          {what()} name:
          {/* The first tabbable element: the dialog focuses it on opening. */}
          <input
            ref={input}
            type="text"
            class={inputClasses({ size: 'sm', class: 'text-sm' })}
            data-testid="pptx-rename-layout-name"
            value={props.name}
            onFocus={(e) => e.currentTarget.select()}
          />
        </label>
        <div class="flex justify-end gap-2">
          <Button size="sm" variant="ghost" onClick={props.onClose}>
            Cancel
          </Button>
          <Button
            size="sm"
            variant="cta"
            type="submit"
            data-testid="pptx-rename-layout-ok"
          >
            Rename
          </Button>
        </div>
        <Button
          size="icon-sm"
          variant="ghost"
          label="Close"
          class="absolute top-3 right-3"
          onClick={props.onClose}
        >
          <X />
        </Button>
      </form>
    </Dialog>
  );
}
