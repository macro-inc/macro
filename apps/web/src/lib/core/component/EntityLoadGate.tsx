import { ThrownResultError } from '@core/util/result';
import { type Accessor, type JSX, Match, Suspense, Switch } from 'solid-js';
import Gone from './AccessErrorViews/Gone';
import NotFound from './AccessErrorViews/NotFound';
import Unauthorized from './AccessErrorViews/Unauthorized';
import { LoadingBlock } from './LoadingBlock';

export type EntityLoadResult<Data> = {
  data: Accessor<Data | undefined>;
  error: Accessor<unknown>;
  isPending: Accessor<boolean>;
};

type EntityLoadGateProps<Data> = {
  result: EntityLoadResult<Data>;
  children: JSX.Element;
};

function getErrorCode(error: unknown): string | null {
  if (error instanceof ThrownResultError) {
    return error.errors[0]?.code ?? null;
  }
  return null;
}

/** Renders entity content or the appropriate loading and access-error view. */
export function EntityLoadGate<Data>(props: EntityLoadGateProps<Data>) {
  const errorCode = () => getErrorCode(props.result.error());

  return (
    <Suspense fallback={<LoadingBlock />}>
      <Switch
        fallback={
          <div class="flex flex-col items-center justify-center h-full text-lg">
            Sorry, an unexpected error has occurred.
          </div>
        }
      >
        <Match
          when={errorCode() === 'UNAUTHORIZED' || errorCode() === 'FORBIDDEN'}
        >
          <Unauthorized />
        </Match>
        <Match when={errorCode() === 'NOT_FOUND'}>
          <NotFound />
        </Match>
        <Match when={errorCode() === 'GONE'}>
          <Gone />
        </Match>
        <Match when={props.result.error()}>
          <div class="flex flex-col items-center justify-center h-full text-lg">
            Sorry, an unexpected error has occurred.
          </div>
        </Match>
        <Match when={props.result.isPending()}>
          <LoadingBlock />
        </Match>
        <Match when={props.result.data()}>{props.children}</Match>
      </Switch>
    </Suspense>
  );
}
