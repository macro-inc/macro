import { BlockContainer } from '@core/component/BlockContainer';
import { blockDataSignal } from '@core/internal/BlockLoader';
import { nativeNetworkStatus } from '@core/mobile/native-network-status';
import { blockErrorSignal, blockLoadRetrySignal } from '@core/signal/load';
import { type FlowProps, Match, Show, Switch, splitProps } from 'solid-js';
import Gone from './AccessErrorViews/Gone';
import NotFound from './AccessErrorViews/NotFound';
import Unauthorized from './AccessErrorViews/Unauthorized';
import { LoadErrorPanel } from './EntityLoadGate';
import { LoadingPanel } from './LoadingSpinner';

export function DocumentBlockContainer(
  props: FlowProps<{ usesCenterBar?: boolean; title?: string }>
) {
  const blockData = blockDataSignal.get;
  const blockError = blockErrorSignal.get;
  const setLoadRetry = blockLoadRetrySignal.set;
  const retryLoad = () => setLoadRetry((count) => (count ?? 0) + 1);

  const hasBlockData = () => blockData() != null;
  const [local, others] = splitProps(props, ['usesCenterBar']);

  const isLoading = () => !hasBlockData() && !blockError();

  return (
    <Show
      when={hasBlockData() && !blockError()}
      fallback={
        <ContainerWithTopBar {...local}>
          {/* The fallback is every non-structural failure (`INVALID`,
              `UNKNOWN`): retryable, like EntityLoadGate's LOAD_FAILED. */}
          <Switch
            fallback={
              <LoadErrorPanel
                title="Unable to load this document"
                onRetry={retryLoad}
              />
            }
          >
            {/* An offline load with nothing to show would otherwise spin
                forever — its pending fetch resumes once connectivity
                returns, so no Retry (a second concurrent load could leak
                the first one's sync source). */}
            <Match when={isLoading() && nativeNetworkStatus() === 'offline'}>
              <LoadErrorPanel title="Unable to load this document" />
            </Match>
            <Match when={isLoading()}>
              <LoadingPanel />
            </Match>
            <Match when={blockError() === 'UNAUTHORIZED'}>
              <Unauthorized />
            </Match>
            <Match when={blockError() === 'MISSING'}>
              <NotFound />
            </Match>
            <Match when={blockError() === 'GONE'}>
              <Gone />
            </Match>
          </Switch>
        </ContainerWithTopBar>
      }
    >
      <BlockContainer {...others} />
    </Show>
  );
}

function ContainerWithTopBar(props: FlowProps<{ usesCenterBar?: boolean }>) {
  return (
    <div class="relative flex flex-col grow select-none size-full">
      <div class="overflow-hidden size-full">{props.children}</div>
    </div>
  );
}
