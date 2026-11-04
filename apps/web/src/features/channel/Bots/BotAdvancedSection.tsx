import CaretUpIcon from '@icon/system/regular/caret-up.svg';
import { Button } from '@ui';
import { CollapseTransition } from '@ui/components/CollapseTransition';
import { createSignal, createUniqueId, type JSX } from 'solid-js';

export function BotAdvancedSection(props: { children: JSX.Element }) {
  const [open, setOpen] = createSignal(false);
  const contentId = createUniqueId();

  return (
    <div class="border-t border-edge-muted pt-3">
      <Button
        type="button"
        variant="ghost"
        class="w-full justify-between"
        aria-expanded={open()}
        aria-controls={contentId}
        onClick={() => setOpen((value) => !value)}
      >
        Advanced
        <CaretUpIcon
          class="transition-transform size-3.5 touch:size-6 shrink-0 pointer-events-none"
          classList={{ 'rotate-180': open() }}
        />
      </Button>
      <div id={contentId}>
        <CollapseTransition open={open()}>
          <div class="flex flex-col gap-5 pt-4">{props.children}</div>
        </CollapseTransition>
      </div>
    </div>
  );
}
