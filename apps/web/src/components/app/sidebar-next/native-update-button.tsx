import ArrowCircleUpIcon from '@phosphor/arrow-circle-up.svg';
import { Button } from '@ui';
import { createSignal, lazy, Show, Suspense } from 'solid-js';
import { NavGlyph } from './nav-glyph';

const NativeUpdateDialog = lazy(() => import('./native-update-dialog'));

export function NativeUpdateButton(props: {
  preparing: boolean;
  onRestart: () => void;
}) {
  const [open, setOpen] = createSignal(false);
  let trigger: HTMLButtonElement | undefined;

  return (
    <>
      <Button
        ref={trigger}
        variant="accent"
        size="icon-md"
        class="size-10 cursor-default rounded-xl"
        label="Update available"
        tooltip="Update available"
        tooltipPlacement="right"
        aria-haspopup="dialog"
        aria-expanded={open()}
        data-sidebar-next-item="app-update"
        onClick={() => setOpen(true)}
      >
        <NavGlyph icon={ArrowCircleUpIcon} class="size-6" />
      </Button>
      <Show when={open()}>
        <Suspense>
          <NativeUpdateDialog
            preparing={props.preparing}
            onClose={() => setOpen(false)}
            onRestoreFocus={() => trigger?.focus()}
            onRestart={props.onRestart}
          />
        </Suspense>
      </Show>
    </>
  );
}
