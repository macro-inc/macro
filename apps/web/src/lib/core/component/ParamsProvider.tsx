import { createMethodRegistration } from '@core/orchestrator';
import { blockHandleSignal } from '@core/signal/load';
import { useSearchParams } from '@solidjs/router';
import {
  type Accessor,
  createContext,
  createMemo,
  createSignal,
  type ParentProps,
  useContext,
} from 'solid-js';

type ParamSchema = Record<string, string>;

type ParamMap = Record<string, string | undefined>;

type ResolvedParams<T extends ParamSchema> = {
  [K in keyof T]: Accessor<string | undefined>;
};

type ParamSource = 'url' | 'block';

type ParamSourceState = {
  params: ParamMap;
  revisions: Record<string, number | undefined>;
};

export type ResolvedParamState = {
  value: string | undefined;
  source: ParamSource | null;
  revision: number;
};

type ResolvedParamStates<T extends ParamSchema> = {
  [K in keyof T]: Accessor<ResolvedParamState>;
};

const EMPTY_PARAM_SOURCE_STATE: ParamSourceState = {
  params: {},
  revisions: {},
};

const paramMapKeys = (...maps: ParamMap[]) => [
  ...new Set(maps.flatMap((map) => Object.keys(map))),
];

const ParamsContext = createContext<Accessor<ParamMap>>(() => ({}));
const ParamSourcesContext = createContext<
  Accessor<{ url: ParamSourceState; block: ParamSourceState }>
>(() => ({
  url: EMPTY_PARAM_SOURCE_STATE,
  block: EMPTY_PARAM_SOURCE_STATE,
}));

export function ParamsProvider(props: ParentProps) {
  const [searchParams] = useSearchParams();

  let nextParamRevision = 0;

  const urlParamsState = createMemo<ParamSourceState>((previous) => {
    const params: ParamMap = {};

    for (const key in searchParams) {
      const val = searchParams[key];
      params[key] = Array.isArray(val) ? val[0] : val;
    }

    let changed = false;
    const revisions = { ...previous.revisions };
    for (const key of paramMapKeys(previous.params, params)) {
      if (previous.params[key] !== params[key]) {
        revisions[key] = ++nextParamRevision;
        changed = true;
      }
    }

    return changed ? { params, revisions } : previous;
  }, EMPTY_PARAM_SOURCE_STATE);

  const [blockParamsState, setBlockParamsState] =
    createSignal<ParamSourceState>(EMPTY_PARAM_SOURCE_STATE);

  const blockHandle = blockHandleSignal.get;

  createMethodRegistration(blockHandle, {
    goToLocationFromParams: (params: Record<string, string>) => {
      const nextParams = { ...params };
      setBlockParamsState((previous) => {
        const revisions = { ...previous.revisions };
        for (const key of paramMapKeys(previous.params, nextParams)) {
          if (key in nextParams || previous.params[key] !== undefined) {
            revisions[key] = ++nextParamRevision;
          }
        }

        return { params: nextParams, revisions };
      });
    },
  });

  const merged = createMemo<ParamMap>(() => {
    const url = urlParamsState();
    const block = blockParamsState();

    return { ...url.params, ...block.params };
  });

  const paramSources = createMemo(() => ({
    url: urlParamsState(),
    block: blockParamsState(),
  }));

  return (
    <ParamSourcesContext.Provider value={paramSources}>
      <ParamsContext.Provider value={merged}>
        {props.children}
      </ParamsContext.Provider>
    </ParamSourcesContext.Provider>
  );
}

export function useUrlParams<T extends ParamSchema>(
  schema: T
): ResolvedParams<T> {
  const raw = useContext(ParamsContext);

  return Object.fromEntries(
    Object.entries(schema).map(([key, param]) => [key, () => raw()[param]])
  ) as ResolvedParams<T>;
}

export function useResolvedUrlParams<T extends ParamSchema>(
  schema: T
): ResolvedParamStates<T> {
  const sources = useContext(ParamSourcesContext);

  return Object.fromEntries(
    Object.entries(schema).map(([key, param]) => [
      key,
      createMemo<ResolvedParamState>(
        (previous) => {
          const { url, block } = sources();
          const urlRevision = url.revisions[param] ?? 0;
          const blockRevision = block.revisions[param] ?? 0;
          const source = blockRevision > urlRevision ? 'block' : 'url';
          const revision = source === 'block' ? blockRevision : urlRevision;
          const value =
            revision === 0
              ? undefined
              : source === 'block'
                ? block.params[param]
                : url.params[param];
          const next: ResolvedParamState = {
            value,
            source: revision === 0 ? null : source,
            revision,
          };

          if (
            previous.value === next.value &&
            previous.source === next.source &&
            previous.revision === next.revision
          ) {
            return previous;
          }

          return next;
        },
        { value: undefined, source: null, revision: 0 }
      ),
    ])
  ) as ResolvedParamStates<T>;
}
