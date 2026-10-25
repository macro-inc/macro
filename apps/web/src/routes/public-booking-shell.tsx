import { hapticImpact } from '@core/mobile/haptics';
import { isNativeMobilePlatform } from '@core/mobile/isNativeMobilePlatform';
import ArrowLeftIcon from '@phosphor/arrow-left.svg';
import { useNavigate } from '@solidjs/router';
import { Button } from '@ui';
import { type ParentProps, Show } from 'solid-js';

/** Native webviews have no browser chrome, including on unavailable pages. */
export function PublicBookingShell(props: ParentProps) {
  const navigate = useNavigate();
  const showBack = () => isNativeMobilePlatform() && window.parent === window;

  return (
    <div class="min-h-0 flex-1 overflow-y-auto bg-page text-ink">
      <Show when={showBack()}>
        <header class="sticky top-0 z-10 flex bg-panel/95 px-2 pb-2 pt-[calc(var(--safe-top,0px)+0.5rem)] backdrop-blur-sm">
          <Button
            variant="ghost"
            size="icon-md"
            label="Back to Macro"
            onPointerDown={() => hapticImpact('light')}
            onClick={() => navigate('/', { replace: true })}
          >
            <ArrowLeftIcon />
          </Button>
        </header>
      </Show>
      {props.children}
    </div>
  );
}
