/**
 * The Spelling pane (Review ▸ Spelling, F7): the misspelled word, Ignore
 * Once / Ignore All / Add, the suggestions, and Change / Change All, laid
 * out like PowerPoint's; ends with "Spell check complete".
 */

import X from '@phosphor/x.svg';
import { Button } from '@ui/components/Button';
import { For, Show } from 'solid-js';
import type { SpellingPaneState } from '../primitives/create-spelling-pane';

export function SpellingPane(props: {
  pane: SpellingPaneState;
  readonly: boolean;
  onClose: () => void;
}) {
  const p = props.pane;
  const noAction = () => props.readonly || p.busy() || !p.current();
  return (
    <aside
      class="flex w-64 shrink-0 flex-col border-edge-muted border-l bg-panel"
      data-testid="pptx-spelling-pane"
      aria-label="Spelling"
    >
      <div class="flex h-9 items-center justify-between border-edge-muted border-b px-3">
        <span class="font-semibold text-ink text-sm">Spelling</span>
        <Button
          size="icon-sm"
          variant="ghost"
          label="Close"
          onClick={props.onClose}
        >
          <X />
        </Button>
      </div>
      <Show
        when={!p.complete()}
        fallback={
          <div
            class="flex flex-col items-start gap-3 p-3 text-ink text-sm"
            data-testid="pptx-spelling-complete"
            role="status"
          >
            <span>Spell check complete. You're good to go!</span>
            <Button
              size="sm"
              variant="accent"
              data-testid="pptx-spelling-ok"
              onClick={props.onClose}
            >
              OK
            </Button>
          </div>
        }
      >
        <div class="flex min-h-0 flex-1 flex-col gap-2 p-3">
          <span class="text-ink-muted text-xs">Not in Dictionary</span>
          <div
            class="rounded-md border border-edge-muted bg-input px-2 py-1.5 font-medium text-ink text-sm"
            data-testid="pptx-spelling-word"
          >
            {p.current()?.word ?? ' '}
          </div>
          <div class="flex flex-wrap gap-1">
            <Button
              size="sm"
              variant="outline"
              disabled={noAction()}
              data-testid="pptx-spelling-ignore-once"
              onClick={() => void p.ignoreOnce()}
            >
              Ignore Once
            </Button>
            <Button
              size="sm"
              variant="outline"
              disabled={noAction()}
              data-testid="pptx-spelling-ignore-all"
              onClick={() => void p.ignoreAll()}
            >
              Ignore All
            </Button>
            <Button
              size="sm"
              variant="outline"
              disabled={noAction()}
              data-testid="pptx-spelling-add"
              onClick={() => void p.add()}
            >
              Add
            </Button>
          </div>
          <div class="mt-1 border-edge-muted border-t pt-2 text-ink-muted text-xs">
            Suggestions
          </div>
          <div
            role="listbox"
            aria-label="Suggestions"
            class="min-h-24 overflow-y-auto rounded-md border border-edge-muted bg-input p-1"
            data-testid="pptx-spelling-suggestions"
          >
            <For
              each={p.suggestions()}
              fallback={
                <div class="px-1.5 py-1 text-ink-muted text-xs italic">
                  (no suggestions)
                </div>
              }
            >
              {(s) => (
                <div
                  role="option"
                  tabIndex={-1}
                  aria-selected={p.choice() === s}
                  class="rounded px-1.5 py-1 text-ink text-sm"
                  classList={{
                    'bg-accent-bg text-accent': p.choice() === s,
                    'hover:bg-ink/5': p.choice() !== s,
                  }}
                  data-testid="pptx-spelling-suggestion"
                  onClick={() => p.setChoice(s)}
                  onDblClick={() => {
                    p.setChoice(s);
                    void p.change();
                  }}
                >
                  {s}
                </div>
              )}
            </For>
          </div>
          <div class="flex gap-1">
            <Button
              size="sm"
              variant="accent"
              disabled={noAction() || !p.choice()}
              data-testid="pptx-spelling-change"
              onClick={() => void p.change()}
            >
              Change
            </Button>
            <Button
              size="sm"
              variant="outline"
              disabled={noAction() || !p.choice()}
              data-testid="pptx-spelling-change-all"
              onClick={() => void p.changeAll()}
            >
              Change All
            </Button>
          </div>
          <div class="mt-auto border-edge-muted border-t pt-2 text-ink-muted text-xs">
            English (United States)
          </div>
        </div>
      </Show>
    </aside>
  );
}
