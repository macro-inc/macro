import XIcon from '@phosphor/x.svg';
import { Button, Layer } from '@ui';
import { ThemeTokenEditor } from './ThemeTokenEditor';

/**
 * The inline theme-editing panel: a toolbar over the VNext raw tokens and
 * component-facing semantic assignments, followed by a save action.
 *
 * Editing mutates live color tokens; the parent owns open/close, the editable
 * name, and what save does.
 */
export function ThemeEditor(props: {
  /** The editable theme name (controlled by the parent). */
  name: string;
  onNameChange: (name: string) => void;
  onClose: () => void;
  onSave: () => void;
}) {
  return (
    // A distinct active-editing block: a neutral, slightly elevated surface (one
    // step lighter than the card via Layer depth), inset + rounded so it reads as
    // a nested element. No color-forward accent.
    <Layer depth={3}>
      <div class="mx-3 my-2 flex max-h-[70vh] flex-col gap-3 rounded-xl border border-edge-muted bg-surface px-4 py-4">
        <div class="flex items-center gap-2">
          <Button
            label="Close editor"
            onClick={props.onClose}
            variant="ghost"
            size="icon-sm"
          >
            <XIcon class="size-4" />
          </Button>
          <input
            type="text"
            value={props.name}
            onInput={(e) => props.onNameChange(e.currentTarget.value)}
            spellcheck={false}
            placeholder="Theme name"
            aria-label="Theme name"
            class="w-40 min-w-0 rounded-md border border-edge-muted bg-transparent px-2 py-1 text-xs text-ink outline-none placeholder:text-ink-placeholder focus:border-accent"
          />
          <div class="flex-1" />
        </div>
        <div class="min-h-0 overflow-y-auto pr-1">
          <ThemeTokenEditor />
        </div>
        <div class="flex justify-end">
          <Button variant="outline" size="sm" onClick={props.onSave}>
            Save theme
          </Button>
        </div>
      </div>
    </Layer>
  );
}
