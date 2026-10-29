import ArrowRightIcon from '@icon/system/regular/arrow-right.svg';
import ArrowsClockwiseIcon from '@icon/system/regular/arrows-clockwise.svg';
import XIcon from '@icon/system/regular/x.svg';
import { Button, Dialog, Panel } from '@ui';
import type { JSX } from 'solid-js';
import { RoutineSparkGlyph } from './routine-spark-glyph';

/** The suggestions modal: a header, the list, and a footer of actions. */
export function RoutineSuggestionsDialog(props: {
  open: boolean;
  onOpenChange(open: boolean): void;
  title: string;
  refreshing: boolean;
  onRefresh(): void;
  onSeeAll(): void;
  children: JSX.Element;
}) {
  return (
    <Dialog
      open={props.open}
      onOpenChange={props.onOpenChange}
      class="w-160"
      animate
    >
      <Panel depth={2} class="rounded-xl *:max-h-[80vh]">
        <Panel.Body scroll>
          <div class="relative flex flex-col">
            <header class="relative flex items-start gap-3 px-6 pt-6 pb-4">
              <RoutineSparkGlyph size="lg" />
              <div class="min-w-0 flex-1">
                <Dialog.Title class="text-lg font-semibold tracking-[-0.02em] text-ink">
                  {props.title}
                </Dialog.Title>
                <Dialog.Description class="mt-0.5 text-sm text-ink-muted">
                  Picked by AI from your workspace. Enable one in a click, or
                  open it to edit first.
                </Dialog.Description>
              </div>
              <Dialog.CloseButton
                as={Button}
                variant="ghost"
                size="icon-sm"
                aria-label="Close"
              >
                <XIcon />
              </Dialog.CloseButton>
            </header>
            <div class="relative px-3 pb-3">{props.children}</div>
            <footer class="flex items-center justify-between gap-2 border-t border-edge-muted px-6 py-3">
              <Button
                variant="ghost"
                size="sm"
                disabled={props.refreshing}
                onClick={() => props.onRefresh()}
              >
                <ArrowsClockwiseIcon aria-hidden="true" />
                {props.refreshing ? 'Refreshing…' : 'Refresh suggestions'}
              </Button>
              <Button
                variant="outline"
                size="sm"
                onClick={() => props.onSeeAll()}
              >
                All routines
                <ArrowRightIcon aria-hidden="true" />
              </Button>
            </footer>
          </div>
        </Panel.Body>
      </Panel>
    </Dialog>
  );
}
