import { TOKENS } from '@core/hotkey/tokens';
import ArrowLeftIcon from '@phosphor/arrow-left.svg';
import ArrowRightIcon from '@phosphor/arrow-right.svg';
import CloseIcon from '@phosphor/x.svg';
import { Button } from '@ui';
import { useContext } from 'solid-js';
import { splitBackInterceptor } from '../back-interceptor';
import { SplitPanelContext } from '../context';

const controlClass =
  'size-[26px] shrink-0 rounded-md p-0 text-ink-muted hover:text-ink [&_svg]:size-3.5!';

/** Directly composed split controls for content-owned V2 headers. */
export function ComposedSplitControls() {
  const panel = useContext(SplitPanelContext);
  if (!panel) return null;

  return (
    <div class="flex shrink-0 items-center gap-1">
      <Button
        class={controlClass}
        label="Close"
        hotkey={TOKENS.split.close}
        onClick={panel.handle.close}
      >
        <CloseIcon />
      </Button>
      <div class="flex items-center gap-0.5">
        <Button
          class={controlClass}
          label="Go back"
          hotkey={TOKENS.split.go.back}
          disabled={!panel.handle.canGoBack()}
          onClick={() => {
            if (splitBackInterceptor()?.()) return;
            panel.handle.goBack();
          }}
        >
          <ArrowLeftIcon />
        </Button>
        <Button
          class={controlClass}
          label="Go forward"
          hotkey={TOKENS.split.go.forward}
          disabled={!panel.handle.canGoForward()}
          onClick={panel.handle.goForward}
        >
          <ArrowRightIcon />
        </Button>
      </div>
    </div>
  );
}
