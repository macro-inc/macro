import { blockHandleSignal } from '@core/signal/load';
import { useSearchParams } from '@solidjs/router';
import { createMethodRegistration } from 'core/orchestrator';
import {
  createContext,
  createMemo,
  createSignal,
  type Accessor,
  useContext,
  type ParentProps,
} from 'solid-js';

type ParamSchema = Record<string, string>;

type ParamMap = Record<string, string | undefined>;

type ResolvedParams<T extends ParamSchema> = {
  [K in keyof T]: Accessor<string | undefined>;
};

const ParamsContext = createContext<Accessor<ParamMap>>(() => ({}));

export function ParamsProvider(props: ParentProps) {
  const [searchParams] = useSearchParams();

  const [blockParams, setBlockParams] = createSignal<ParamMap>({});

  const blockHandle = blockHandleSignal.get;

  createMethodRegistration(blockHandle, {
    goToLocationFromParams: (params: Record<string, string>) => {
      setBlockParams({ ...params });
    },
  });

  const merged = createMemo<ParamMap>(() => {
    const flat: ParamMap = {};

    for (const key in searchParams) {
      const val = searchParams[key];
      flat[key] = Array.isArray(val) ? val[0] : val;
    }

    return { ...flat, ...blockParams() };
  });

  return (
    <ParamsContext.Provider value={merged}>
      {props.children}
    </ParamsContext.Provider>
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
