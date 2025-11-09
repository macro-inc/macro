import { useBlockId } from '@core/block';
import { BlockContainer } from '@core/component/BlockContainer';
import { blockDataSignal } from '@core/internal/BlockLoader';
import { blockErrorSignal } from '@core/signal/load';
import { type FlowProps, Match, Show, Switch, splitProps } from 'solid-js';
import Gone from './AccessErrorViews/Gone';
import NotFound from './AccessErrorViews/NotFound';
import Unauthorized from './AccessErrorViews/Unauthorized';
import { LoadingPanel } from './LoadingSpinner';

export function DocumentBlockContainer(
  props: FlowProps<{ usesCenterBar?: boolean; title?: string }>
) {
  const blockData = blockDataSignal.get;
  const blockError = blockErrorSignal.get;

  const hasBlockData = () => blockData() != null;
  const [local, others] = splitProps(props, ['usesCenterBar']);

  const isLoading = () => !hasBlockData() && !blockError();
  const blockId = useBlockId();

  return (
    <Show
      when={hasBlockData()}
      fallback={
        <ContainerWithTopBar {...local}>
          <Switch
            fallback={
              <div class="flex flex-col items-center justify-center h-full text-lg">
                Sorry, an unexpected error has occurred.
              </div>
            }
          >
            <Match when={isLoading()}>
              <LoadingPanel blockId={blockId} />
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
    <div class="relative flex flex-col grow-1 select-none size-full">
      <div class="overflow-hidden size-full">{props.children}</div>
    </div>
  );
}
