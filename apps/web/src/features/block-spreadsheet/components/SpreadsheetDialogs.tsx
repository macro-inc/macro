import CaretDown from '@phosphor/caret-down.svg';
import CaretUp from '@phosphor/caret-up.svg';
import MagnifyingGlass from '@phosphor/magnifying-glass.svg';
import Swap from '@phosphor/swap.svg';
import X from '@phosphor/x.svg';
import { Button } from '@ui/components/Button';
import { createEffect, createSignal, on, Show } from 'solid-js';
import type { FindOptions } from '../core/sheet-operations';
import { SpreadsheetDialog as Dialog } from './SpreadsheetDialog';

type SpreadsheetFindDialogProps = {
  open: boolean;
  onClose: () => void;
  onRestoreFocus?: () => void;
  query: string;
  onQuery: (value: string) => void;
  replacement: string;
  onReplacement: (value: string) => void;
  options: FindOptions;
  onOptions: (value: Partial<FindOptions>) => void;
  matchCount: number;
  matchIndex: number;
  readonly: boolean;
  notice: string;
  onFind: (backwards?: boolean) => void;
  onReplace: (all: boolean) => void;
};

/** Platform find shortcut (Cmd/Ctrl+F). */
function isFindKey(event: KeyboardEvent) {
  return (event.metaKey || event.ctrlKey) && event.code === 'KeyF';
}

/** Compact find bar (channel-style); expands for replace and search options. */
export function SpreadsheetFindDialog(props: SpreadsheetFindDialogProps) {
  const [replacing, setReplacing] = createSignal(false);
  let findInputRef: HTMLInputElement | undefined;

  const focusFind = () => {
    findInputRef?.focus();
    findInputRef?.select();
  };

  createEffect(
    on(
      () => props.open,
      (open) => {
        if (!open) {
          setReplacing(false);
          return;
        }
        queueMicrotask(focusFind);
      }
    )
  );

  const close = () => {
    props.onClose();
    props.onRestoreFocus?.();
  };

  const status = () => {
    if (!props.query) return '';
    if (!props.matchCount) return 'No results';
    const current = props.matchIndex >= 0 ? props.matchIndex + 1 : '–';
    return `${current}/${props.matchCount}`;
  };

  return (
    <Show when={props.open}>
      <div
        role="search"
        aria-label="Find and replace"
        class="absolute top-2 right-3 z-20 flex w-80 max-w-[calc(100%-1.5rem)] flex-col gap-1 rounded-md border border-edge bg-surface p-1 shadow-md focus-within:border-accent touch:top-[calc(var(--mobile-content-inset-top,0)+0.5rem)]"
        onKeyDown={(event) => {
          event.stopPropagation();
          if (event.key === 'Escape') {
            event.preventDefault();
            close();
            return;
          }
          // Stop the browser find dialog while the bar owns keyboard focus.
          if (isFindKey(event)) {
            event.preventDefault();
            focusFind();
          }
        }}
        onPointerDown={(event) => event.stopPropagation()}
      >
        <div class="flex items-center gap-1">
          <Button
            size="icon-sm"
            variant="ghost"
            aria-label="Search"
            classList={{ '!text-accent': !!props.query.trim() }}
            onClick={() => props.onFind()}
          >
            <MagnifyingGlass />
          </Button>
          <input
            ref={findInputRef}
            type="text"
            aria-label="Find in sheet"
            placeholder="Find"
            value={props.query}
            spellcheck={false}
            onInput={(e) => props.onQuery(e.currentTarget.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.isComposing) {
                e.preventDefault();
                props.onFind(e.shiftKey);
              } else if (isFindKey(e)) {
                e.preventDefault();
                focusFind();
              }
            }}
            class="min-w-0 flex-1 border-0 bg-transparent px-1 text-sm text-ink placeholder:text-ink-placeholder outline-none focus:ring-0"
          />
          <span
            role="status"
            class="px-1 text-xs text-ink-muted tabular-nums whitespace-nowrap"
            classList={{ invisible: !status() }}
          >
            {status() || '0/0'}
            {props.notice ? ` · ${props.notice}` : ''}
          </span>
          <Button
            size="icon-sm"
            variant="ghost"
            aria-label="Previous match"
            disabled={!props.matchCount}
            onClick={() => props.onFind(true)}
          >
            <CaretUp />
          </Button>
          <Button
            size="icon-sm"
            variant="ghost"
            aria-label="Next match"
            disabled={!props.matchCount}
            onClick={() => props.onFind()}
          >
            <CaretDown />
          </Button>
          <Show when={!props.readonly}>
            <Button
              size="icon-sm"
              variant="ghost"
              label={replacing() ? 'Hide replace' : 'Replace'}
              aria-pressed={replacing()}
              onClick={() => setReplacing((open) => !open)}
            >
              <Swap />
            </Button>
          </Show>
          <Button
            size="icon-sm"
            variant="ghost"
            aria-label="Close find bar"
            onClick={close}
          >
            <X />
          </Button>
        </div>
        <Show when={replacing() && !props.readonly}>
          <div class="flex flex-col gap-1.5 px-1 pb-1">
            <div class="flex items-center gap-1">
              <input
                type="text"
                aria-label="Replace with"
                placeholder="Replace with"
                value={props.replacement}
                spellcheck={false}
                onInput={(e) => props.onReplacement(e.currentTarget.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && !e.isComposing) {
                    e.preventDefault();
                    props.onReplace(false);
                  }
                }}
                class="h-7 min-w-0 flex-1 rounded-md border border-edge-muted bg-input px-2 text-sm text-ink outline-none focus:border-accent"
              />
              <Button
                size="sm"
                variant="outline"
                disabled={props.matchIndex < 0}
                onClick={() => props.onReplace(false)}
              >
                Replace
              </Button>
              <Button
                size="sm"
                variant="outline"
                disabled={!props.matchCount}
                onClick={() => props.onReplace(true)}
              >
                All
              </Button>
            </div>
            <div class="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-ink-muted">
              <label class="flex items-center gap-1.5">
                <input
                  type="checkbox"
                  checked={props.options.matchCase}
                  onChange={(e) =>
                    props.onOptions({ matchCase: e.currentTarget.checked })
                  }
                />
                Match case
              </label>
              <label class="flex items-center gap-1.5">
                <input
                  type="checkbox"
                  checked={props.options.entireCell}
                  onChange={(e) =>
                    props.onOptions({ entireCell: e.currentTarget.checked })
                  }
                />
                Entire cell
              </label>
              <label class="flex items-center gap-1.5">
                <input
                  type="checkbox"
                  checked={props.options.formulas}
                  onChange={(e) =>
                    props.onOptions({ formulas: e.currentTarget.checked })
                  }
                />
                Formulas
              </label>
            </div>
          </div>
        </Show>
      </div>
    </Show>
  );
}

/** Confirms that moved cells replace values already at their destination. */
export function SpreadsheetMoveDialog(props: {
  open: boolean;
  onConfirm: () => void;
  onClose: () => void;
  onRestoreFocus?: () => void;
}) {
  return (
    <Dialog
      onRestoreFocus={props.onRestoreFocus}
      open={props.open}
      onOpenChange={(open) => {
        if (!open) props.onClose();
      }}
      position="center"
      class="w-96"
    >
      <form
        class="p-5 text-ink"
        onKeyDown={(event) => event.stopPropagation()}
        onSubmit={(event) => {
          event.preventDefault();
          props.onConfirm();
        }}
      >
        <Dialog.Title class="mb-2 text-sm font-semibold">
          Replace cells?
        </Dialog.Title>
        <Dialog.Description class="mb-4 text-sm text-ink-muted">
          There are already values where you are moving these cells. Moving
          replaces them, and formulas that refer to them show #REF!. You can
          undo this change.
        </Dialog.Description>
        <div class="mt-5 flex justify-end gap-2">
          <Button
            variant="ghost"
            size="sm"
            type="button"
            onClick={props.onClose}
          >
            Cancel
          </Button>
          <Button size="sm" variant="strong" type="submit">
            Replace
          </Button>
        </div>
      </form>
    </Dialog>
  );
}
