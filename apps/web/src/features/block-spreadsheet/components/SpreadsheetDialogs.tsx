import X from '@phosphor/x.svg';
import { Button } from '@ui/components/Button';
import type { FindOptions } from '../core/sheet-operations';
import { SpreadsheetDialog as Dialog } from './SpreadsheetDialog';

export function SpreadsheetFindDialog(props: {
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
}) {
  return (
    <Dialog
      onRestoreFocus={props.onRestoreFocus}
      open={props.open}
      onOpenChange={(open) => {
        if (!open) props.onClose();
      }}
      position="center"
      class="w-108"
    >
      <div class="p-5 text-ink" onKeyDown={(event) => event.stopPropagation()}>
        <div class="mb-4 flex items-center justify-between">
          <Dialog.Title class="text-sm font-semibold">
            Find and replace
          </Dialog.Title>
          <Button
            label="Close find and replace"
            size="icon-sm"
            class="order-last text-ink-muted"
            tabIndex={-1}
            onClick={props.onClose}
          >
            <X class="size-4" />
          </Button>
        </div>
        <Dialog.Description class="mb-4 text-xs text-ink-muted">
          Search this sheet. Formula results are preserved unless you choose to
          search formulas.
        </Dialog.Description>
        <label class="mb-3 block text-xs">
          <span class="mb-1.5 block">Find</span>
          <input
            aria-label="Find in sheet"
            value={props.query}
            onInput={(e) => props.onQuery(e.currentTarget.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.isComposing) {
                e.preventDefault();
                props.onFind(e.shiftKey);
              }
            }}
            class="h-9 w-full touch:h-[44px] touch:text-[max(16px,1rem)] rounded-md border border-edge-muted bg-input px-3 text-sm outline-none focus:border-accent"
          />
        </label>
        <label class="mb-4 block text-xs">
          <span class="mb-1.5 block">Replace with</span>
          <input
            aria-label="Replace with"
            value={props.replacement}
            disabled={props.readonly}
            onInput={(e) => props.onReplacement(e.currentTarget.value)}
            class="h-9 w-full touch:h-[44px] touch:text-[max(16px,1rem)] rounded-md border border-edge-muted bg-input px-3 text-sm outline-none focus:border-accent disabled:opacity-40"
          />
        </label>
        <div class="flex flex-col gap-2.5 text-xs text-ink-muted">
          <label class="flex items-center gap-2 touch:min-h-[44px]">
            <input
              type="checkbox"
              class="touch:size-[20px]"
              checked={props.options.matchCase}
              onChange={(e) =>
                props.onOptions({ matchCase: e.currentTarget.checked })
              }
            />
            Match case
          </label>
          <label class="flex items-center gap-2 touch:min-h-[44px]">
            <input
              type="checkbox"
              class="touch:size-[20px]"
              checked={props.options.entireCell}
              onChange={(e) =>
                props.onOptions({ entireCell: e.currentTarget.checked })
              }
            />
            Match entire cell contents
          </label>
          <label class="flex items-center gap-2 touch:min-h-[44px]">
            <input
              type="checkbox"
              class="touch:size-[20px]"
              checked={props.options.formulas}
              onChange={(e) =>
                props.onOptions({ formulas: e.currentTarget.checked })
              }
            />
            Search within formulas
          </label>
        </div>
        <p role="status" class="min-h-10 py-3 text-xs text-ink-muted">
          {props.query
            ? `${props.matchIndex >= 0 ? props.matchIndex + 1 : 0} of ${props.matchCount} matches`
            : 'Enter text to search'}
          {props.notice ? ` · ${props.notice}` : ''}
        </p>
        <div class="flex flex-wrap justify-end gap-2 border-t border-edge-muted pt-3">
          <Button
            size="sm"
            disabled={!props.matchCount || props.readonly}
            onClick={() => props.onReplace(true)}
          >
            Replace all
          </Button>
          <Button
            size="sm"
            disabled={props.matchIndex < 0 || props.readonly}
            onClick={() => props.onReplace(false)}
          >
            Replace
          </Button>
          <Button
            size="sm"
            variant="accent"
            disabled={!props.matchCount}
            onClick={() => props.onFind()}
          >
            Find next
          </Button>
        </div>
      </div>
    </Dialog>
  );
}
