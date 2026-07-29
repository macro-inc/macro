import { TabsInset } from '@core/component/TabsInset';
import ShuffleIcon from '@phosphor/shuffle.svg';
import XIcon from '@phosphor/x.svg';
import { Button, Layer } from '@ui';
import { createSignal, Show } from 'solid-js';
import { ThemeEditorAdvanced } from './ThemeEditorAdvanced';
import { randomizeTheme, ThemeEditorBasic } from './ThemeEditorBasic';

type EditorTab = 'basic' | 'advanced';

/**
 * The inline theme-editing panel: a toolbar (close, name, randomize, Basic /
 * Variables tabs) over the Basic and Advanced (variables) editors, plus a save
 * action. Rendered beneath a theme selector while its editor is open — mounting
 * fresh each time resets the tab to Basic.
 *
 * Editing mutates the live theme tokens directly (via the Basic/Advanced
 * editors); the parent owns open/close, the editable name, and what save does.
 */
export function ThemeEditor(props: {
  /** The editable theme name (controlled by the parent). */
  name: string;
  onNameChange: (name: string) => void;
  onClose: () => void;
  onSave: () => void;
}) {
  const [editorTab, setEditorTab] = createSignal<EditorTab>('basic');

  return (
    // A distinct active-editing block: a neutral, slightly elevated surface (one
    // step lighter than the card via Layer depth), inset + rounded so it reads as
    // a nested element. No color-forward accent.
    <Layer depth={3}>
      <div class="mx-3 my-2 flex flex-col gap-3 rounded-xl border border-ink/[0.05] bg-surface px-4 py-4">
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
            class="w-40 min-w-0 rounded-md border border-edge-muted bg-transparent px-2 py-1 text-xs text-ink outline-none placeholder:text-ink-extra-muted focus:border-accent"
          />
          <div class="flex-1" />
          <Button
            label="Randomize theme"
            onPointerDown={randomizeTheme}
            variant="ghost"
            size="icon-sm"
          >
            <ShuffleIcon class="size-4" />
          </Button>
          <TabsInset
            depth={3}
            onChange={(value) => setEditorTab(value as EditorTab)}
            list={[
              { value: 'basic', label: 'Basic' },
              { value: 'advanced', label: 'Variables' },
            ]}
            value={editorTab()}
            defaultValue="basic"
          />
        </div>
        <div class="relative overflow-hidden rounded-lg">
          {/* The Basic view defines the box height; it stays mounted (just
              hidden) on the Variables tab so the variables list scrolls within
              that same height. Basic rows use dividers only; the Variables list
              keeps a bordered container. */}
          <div classList={{ invisible: editorTab() !== 'basic' }}>
            <ThemeEditorBasic />
          </div>
          <Show when={editorTab() === 'advanced'}>
            <div class="absolute inset-0 overflow-y-auto rounded-lg border border-ink/[0.05] bg-surface">
              <ThemeEditorAdvanced />
            </div>
          </Show>
        </div>
        <div class="flex justify-end">
          <Button variant="base" size="sm" onClick={props.onSave}>
            Save theme
          </Button>
        </div>
      </div>
    </Layer>
  );
}
