import { createMethodRegistration } from '@core/orchestrator';
import { blockHandleSignal } from '@core/signal/load';
import { useSearchParams } from '@solidjs/router';
import {
  type Accessor,
  batch,
  createContext,
  type ParentProps,
  useContext,
} from 'solid-js';
import { createStore } from 'solid-js/store';

type ParamSchema = Record<string, string>;

type ParamMap = Record<string, string | undefined>;

// Use a version-bumping pattern to trigger successive reactive updates when
// calling goToLocationFromParams multiple times even with same values.
type ParamVersions = Record<string, number | undefined>;

type ResolvedParams<T extends ParamSchema> = {
  [K in keyof T]: Accessor<string | undefined>;
};

/**
 * Provides stable per-param accessors so unrelated params do not invalidate
 * consumers.
 */
type ParamsContextValue = {
  getParam: (param: string) => Accessor<string | undefined>;
};

const ParamsContext = createContext<ParamsContextValue>({
  getParam: () => () => undefined,
});

function flattenParamValue(
  val: string | string[] | undefined
): string | undefined {
  return Array.isArray(val) ? val[0] : val;
}

export function ParamsProvider(props: ParentProps) {
  const [searchParams] = useSearchParams();
  const [blockParams, setBlockParams] = createStore<ParamMap>({});
  const [navigationVersions, setNavigationVersions] =
    createStore<ParamVersions>({});

  const blockHandle = blockHandleSignal.get;

  createMethodRegistration(blockHandle, {
    goToLocationFromParams: (params: Record<string, string>) => {
      batch(() => {
        const paramNames = new Set([
          ...Object.keys(blockParams),
          ...Object.keys(params),
        ]);

        for (const param of paramNames) {
          setBlockParams(param, params[param]);
        }

        for (const param of Object.keys(params)) {
          setNavigationVersions(param, (navigationVersions[param] ?? 0) + 1);
        }
      });
    },
  });

  const context: ParamsContextValue = {
    getParam: (param) => () => {
      navigationVersions[param];

      const blockValue = blockParams[param];
      if (blockValue !== undefined) return blockValue;

      return flattenParamValue(searchParams[param]);
    },
  };

  return (
    <ParamsContext.Provider value={context}>
      {props.children}
    </ParamsContext.Provider>
  );
}

/**
 * Returns URL/block params scoped to the requested schema keys. The context
 * provides additional logic for retriggering signals on successive calls
 * to `goToLocationFromParams` with the same values.
 */
export function useUrlParams<T extends ParamSchema>(
  schema: T
): ResolvedParams<T> {
  const params = useContext(ParamsContext);

  return Object.fromEntries(
    Object.entries(schema).map(([key, param]) => [key, params.getParam(param)])
  ) as ResolvedParams<T>;
}
