import { ListSkeleton } from '@app/components/view-shell/ListSkeleton';
import { useBlockId, useIsNestedBlock } from '@core/block';
import { LoadingBlock } from '@core/component/LoadingBlock';
import { blockLoadRetrySignal } from '@core/signal/load';
import { fireAndForget } from '@core/util/fireAndForget';
import { Telemetry } from '@macro-inc/observability';
import { queryClient } from '@queries/client';
import { formsKeys } from '@queries/storage/keys';
import { Button } from '@ui';
import { createSignal, onCleanup, Show } from 'solid-js';

/** How long a card waits on its form before saying it didn't load. */
const STALLED_AFTER_MS = 10_000;

/**
 * The form block while its code or first answer loads. In a message card the
 * generic `LoadingBlock` can show nothing: its spinner fades in only once a
 * mount effect runs, and an empty card has been seen. This skeleton shows
 * without any effect. A card still waiting after ten seconds reports what it
 * waits on and offers to load again instead of a skeleton that never ends.
 */
export function FormBlockLoading() {
  const nested = useIsNestedBlock();
  return (
    <Show when={nested} fallback={<LoadingBlock />}>
      <FormCardLoading />
    </Show>
  );
}

function FormCardLoading() {
  const formId = useBlockId();
  const setLoadRetry = blockLoadRetrySignal.set;
  const [stalled, setStalled] = createSignal(false);
  // The block's code is this same import, so this settles when it arrives.
  let codeLoaded = false;
  fireAndForget(
    (async () => {
      await import('./form-block');
      codeLoaded = true;
    })(),
    'form-card-loading'
  );
  // A plain timer, not an effect: effects are what may be held.
  let timer: ReturnType<typeof setTimeout> | undefined;
  const wait = () => {
    clearTimeout(timer);
    setStalled(false);
    timer = setTimeout(() => {
      setStalled(true);
      const detail = queryClient.getQueryState(
        formsKeys.detail(formId).queryKey
      );
      Telemetry.warn('form.card.stalled', {
        'form.id': formId,
        'form.code_loaded': codeLoaded,
        'form.detail_status': detail?.status ?? 'absent',
        'form.detail_fetch_status': detail?.fetchStatus ?? 'absent',
        'form.stalled_after_ms': STALLED_AFTER_MS,
      });
    }, STALLED_AFTER_MS);
  };
  wait();
  onCleanup(() => clearTimeout(timer));

  const retry = () => {
    setLoadRetry((count) => (count ?? 0) + 1);
    queryClient.invalidateQueries({
      queryKey: formsKeys.detail(formId).queryKey,
    });
    wait();
  };

  return (
    <Show
      when={stalled()}
      fallback={
        <div role="status" aria-label="Loading form" class="p-3">
          <ListSkeleton.Bar class="h-24 w-full rounded-xl" />
        </div>
      }
    >
      <div
        role="alert"
        class="flex min-h-24 flex-col items-center justify-center gap-2 p-3 text-sm text-ink-muted"
      >
        <p>Couldn’t load this form.</p>
        <Button variant="secondary" size="sm" onClick={retry}>
          Retry
        </Button>
      </div>
    </Show>
  );
}
