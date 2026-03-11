import CheckCircle from '@icon/regular/check-circle.svg';
import Spinner from '@icon/regular/spinner.svg';
import { cn } from '@ui/utils/classname';
import {
  type Accessor,
  createEffect,
  createSignal,
  on,
  onCleanup,
  Show,
} from 'solid-js';

type LoaderState = 'hidden' | 'loading' | 'success';

interface FloatingInputLoaderProps {
  isLoading: Accessor<boolean>;
  minShowTime?: number;
  successDuration?: number;
  loadingText?: string;
  successText?: string;
  class?: string;
}

export function FloatingInputLoader(props: FloatingInputLoaderProps) {
  const minShowTime = props.minShowTime ?? 1000;
  const successDuration = props.successDuration ?? 500;

  const [loaderState, setLoaderState] = createSignal<LoaderState>('hidden');
  const [displayState, setDisplayState] = createSignal<'loading' | 'success'>(
    'loading'
  );
  let loadingStartTime: number | null = null;
  let successTimeoutId: ReturnType<typeof setTimeout> | undefined;
  let minTimeTimeoutId: ReturnType<typeof setTimeout> | undefined;

  const clearTimeouts = () => {
    if (successTimeoutId) {
      clearTimeout(successTimeoutId);
      successTimeoutId = undefined;
    }
    if (minTimeTimeoutId) {
      clearTimeout(minTimeTimeoutId);
      minTimeTimeoutId = undefined;
    }
  };

  onCleanup(clearTimeouts);

  createEffect(
    on(
      () => props.isLoading(),
      (loading) => {
        const currentState = loaderState();

        if (loading) {
          if (currentState === 'hidden') {
            clearTimeouts();
            loadingStartTime = Date.now();
            setDisplayState('loading');
            setLoaderState('loading');
          }
        } else if (currentState === 'loading') {
          const elapsed = loadingStartTime ? Date.now() - loadingStartTime : 0;
          const remaining = Math.max(0, minShowTime - elapsed);

          minTimeTimeoutId = setTimeout(() => {
            setDisplayState('success');
            setLoaderState('success');
            successTimeoutId = setTimeout(() => {
              setLoaderState('hidden');
              loadingStartTime = null;
            }, successDuration);
          }, remaining);
        }
      }
    )
  );

  const isVisible = () => loaderState() !== 'hidden';
  const showSuccess = () => displayState() === 'success';

  return (
    <div
      class={cn(
        'absolute bottom-full left-1/2 -translate-x-1/2 mb-2 transition-all duration-200 ease-out',
        isVisible()
          ? 'opacity-100 translate-y-0'
          : 'opacity-0 translate-y-1 pointer-events-none',
        props.class
      )}
    >
      <div class="flex items-center gap-2 px-3 py-1.5 rounded-md bg-panel border border-edge-muted shadow-sm">
        <Show
          when={showSuccess()}
          fallback={
            <>
              <Spinner class="size-4 animate-spin text-ink-muted" />
              <Show when={props.loadingText}>
                <span class="text-xs text-ink-muted whitespace-nowrap">
                  {props.loadingText}
                </span>
              </Show>
            </>
          }
        >
          <CheckCircle class="size-4 text-success-ink" />
          <Show when={props.successText}>
            <span class="text-xs text-success-ink whitespace-nowrap">
              {props.successText}
            </span>
          </Show>
        </Show>
      </div>
    </div>
  );
}
