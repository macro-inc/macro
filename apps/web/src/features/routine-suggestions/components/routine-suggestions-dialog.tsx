import { t } from '@app/lib/i18n';
import ArrowRightIcon from '@icon/system/regular/arrow-right.svg';
import XIcon from '@icon/system/regular/x.svg';
import { Button, Dialog, Panel } from '@ui';
import type { JSX } from 'solid-js';

/**
 * The suggestions dialog: a title and what to do, the host's kind tabs and
 * a close button, the cards, and a footer that leads to every routine.
 */
export function RoutineSuggestionsDialog(props: {
  open: boolean;
  onOpenChange(open: boolean): void;
  title: string;
  description: string;
  /** Beside the title, e.g. For you and Templates tabs. */
  tabs?: JSX.Element;
  /** AI's suggestions are still arriving. */
  generating: boolean;
  onSeeAll(): void;
  children: JSX.Element;
}) {
  return (
    <Dialog
      open={props.open}
      onOpenChange={props.onOpenChange}
      class="w-[860px]"
      animate
    >
      <Panel depth={2} class="rounded-xl *:max-h-[85vh]">
        <Panel.Body scroll>
          <div class="flex flex-col gap-5 p-6">
            <header class="flex min-w-0 items-start gap-3.5">
              <div class="flex min-w-0 flex-1 flex-col gap-1">
                <Dialog.Title class="text-lg font-semibold tracking-[-0.02em] text-ink">
                  {props.title}
                </Dialog.Title>
                <Dialog.Description class="text-sm text-ink-muted">
                  {props.description}
                </Dialog.Description>
              </div>
              {props.tabs}
              <Dialog.CloseButton
                as={Button}
                variant="ghost"
                size="icon-sm"
                aria-label={t('common.close')}
              >
                <XIcon class="size-4" aria-hidden="true" />
              </Dialog.CloseButton>
            </header>
            {props.children}
            <footer class="flex items-center justify-between gap-2">
              <span class="text-xs text-ink-extra-muted" aria-live="polite">
                {props.generating ? t('routineSuggestions.findingMore') : ''}
              </span>
              <Button
                variant="secondary"
                size="sm"
                onClick={() => props.onSeeAll()}
              >
                {t('routineSuggestions.allRoutines')}
                <ArrowRightIcon class="size-4" aria-hidden="true" />
              </Button>
            </footer>
          </div>
        </Panel.Body>
      </Panel>
    </Dialog>
  );
}
