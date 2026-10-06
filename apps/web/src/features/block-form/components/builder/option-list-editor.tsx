import { Popover } from '@kobalte/core/popover';
import Palette from '@phosphor/palette.svg';
import X from '@phosphor/x.svg';
import { ColorSwatches } from '@property/tags/components/color-swatches';
import { Key } from '@solid-primitives/keyed';
import { TagDot } from '@ui';
import { createSignal, Show } from 'solid-js';
import type { FormOption } from '../../core/form-model';
import { ChoiceMarker } from './choice-marker';
import { DraftInput } from './draft-input';

/**
 * A choice question's options, edited in place: each row renames on blur or
 * Enter, recolours, and deletes (emptying the answers that held it). A last
 * row adds one. Rows are keyed by option id, so a read that replaces the
 * options never unmounts the row being typed in.
 */
export function OptionListEditor(props: {
  options: readonly FormOption[];
  multi: boolean;
  /** Resolves whether the option was added; on false the text comes back. */
  onAdd: (label: string) => Promise<boolean>;
  onRename: (optionId: string, label: string) => void;
  onRecolor: (optionId: string, color: string) => void;
  onDelete: (optionId: string) => void;
}) {
  const [draft, setDraft] = createSignal('');
  const addDraft = async () => {
    const label = draft().trim();
    if (!label) return;
    setDraft('');
    const added = await props.onAdd(label);
    if (!added && !draft()) setDraft(label);
  };
  return (
    <ul class="flex flex-col gap-1" aria-label="Options">
      <Key each={props.options} by={(option) => option.id}>
        {(option, index) => (
          <li class="group/option flex items-center gap-2">
            <ChoiceMarker multi={props.multi} />
            <DraftInput
              aria-label={`Option ${index() + 1}`}
              value={option().label}
              maxlength={200}
              class="h-8 min-w-0 flex-1 rounded-md border border-transparent bg-transparent px-2 text-sm text-ink outline-none hover:border-edge-muted focus:border-edge-focus focus:bg-input"
              onCommit={(label) => props.onRename(option().id, label)}
            />
            <Popover placement="bottom-end" gutter={4}>
              <Popover.Trigger
                aria-label={`Colour of ${option().label}`}
                class="flex size-7 items-center justify-center rounded-md text-ink-muted outline-none hover:bg-hover focus-visible:ring-2 focus-visible:ring-edge-focus"
              >
                <Show
                  when={option().color}
                  fallback={<Palette class="size-3.5" />}
                >
                  {(color) => <TagDot fill={color()} size="lg" />}
                </Show>
              </Popover.Trigger>
              <Popover.Portal>
                <Popover.Content class="z-action-menu rounded-lg border border-edge bg-menu p-2 shadow-menu outline-none">
                  <ColorSwatches
                    size="sm"
                    value={option().color ?? undefined}
                    onChange={(choice) =>
                      props.onRecolor(option().id, choice.color)
                    }
                  />
                </Popover.Content>
              </Popover.Portal>
            </Popover>
            <button
              type="button"
              aria-label={`Delete option ${option().label}`}
              disabled={props.options.length <= 1}
              class="flex size-7 items-center justify-center rounded-md text-ink-muted opacity-0 outline-none transition-opacity group-hover/option:opacity-100 hover:bg-hover hover:text-failure-ink focus-visible:opacity-100 focus-visible:ring-2 focus-visible:ring-edge-focus disabled:hidden touch:opacity-100"
              onClick={() => props.onDelete(option().id)}
            >
              <X class="size-3.5" />
            </button>
          </li>
        )}
      </Key>
      <li class="flex items-center gap-2">
        <ChoiceMarker multi={props.multi} />
        <input
          aria-label="Add option"
          placeholder="Add option"
          value={draft()}
          maxlength={200}
          class="h-8 min-w-0 flex-1 rounded-md border border-transparent bg-transparent px-2 text-sm text-ink outline-none placeholder:text-ink-placeholder hover:border-edge-muted focus:border-edge-focus focus:bg-input"
          onInput={(event) => setDraft(event.currentTarget.value)}
          onKeyDown={(event) => {
            if (event.isComposing || event.key !== 'Enter') return;
            event.preventDefault();
            void addDraft();
          }}
          onBlur={() => void addDraft()}
        />
      </li>
    </ul>
  );
}
