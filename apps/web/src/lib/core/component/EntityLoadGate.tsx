import { ThrownResultError } from '@core/util/result';
import { type Accessor, type JSX, Match, Suspense, Switch } from 'solid-js';
import Gone from './AccessErrorViews/Gone';
import NotFound from './AccessErrorViews/NotFound';
import Unauthorized from './AccessErrorViews/Unauthorized';
import { LoadingBlock } from './LoadingBlock';

export type EntityLoadErrorCode =
  | 'UNAUTHORIZED'
  | 'FORBIDDEN'
  | 'NOT_FOUND'
  | 'GONE';

export type EntityLoadError = EntityLoadErrorCode | 'UNEXPECTED';

export type EntityLoadResult<Data> = {
  data: Accessor<Data | undefined>;
  error: Accessor<EntityLoadError | undefined>;
  isPending: Accessor<boolean>;
};

type EntityLoadGateProps<Data> = {
  result: EntityLoadResult<Data>;
  children: JSX.Element;
};

const ENTITY_LOAD_ERROR_CODES: ReadonlySet<string> = new Set([
  'UNAUTHORIZED',
  'FORBIDDEN',
  'NOT_FOUND',
  'GONE',
]);

function isEntityLoadErrorCode(code: string): code is EntityLoadErrorCode {
  return ENTITY_LOAD_ERROR_CODES.has(code);
}

/** Normalizes a query error into the error states supported by the gate. */
export function toEntityLoadError(error: unknown): EntityLoadError | undefined {
  if (error === undefined || error === null) return undefined;
  if (typeof error === 'string' && isEntityLoadErrorCode(error)) return error;
  if (error instanceof ThrownResultError) {
    return (
      error.errors.map(({ code }) => code).find(isEntityLoadErrorCode) ??
      'UNEXPECTED'
    );
  }
  return 'UNEXPECTED';
}

/** Renders entity content or the appropriate loading and access-error view. */
export function EntityLoadGate<Data>(props: EntityLoadGateProps<Data>) {
  const error = props.result.error;

  return (
    <Suspense fallback={<LoadingBlock />}>
      <Switch
        fallback={
          <div class="flex flex-col items-center justify-center h-full text-lg">
            Sorry, an unexpected error has occurred.
          </div>
        }
      >
        <Match when={error() === 'UNAUTHORIZED' || error() === 'FORBIDDEN'}>
          <Unauthorized />
        </Match>
        <Match when={error() === 'NOT_FOUND'}>
          <NotFound />
        </Match>
        <Match when={error() === 'GONE'}>
          <Gone />
        </Match>
        <Match when={error() === 'UNEXPECTED'}>
          <div class="flex flex-col items-center justify-center h-full text-lg">
            Sorry, an unexpected error has occurred.
          </div>
        </Match>
        <Match when={props.result.isPending()}>
          <LoadingBlock />
        </Match>
        <Match when={props.result.data() !== undefined}>{props.children}</Match>
      </Switch>
    </Suspense>
  );
}
