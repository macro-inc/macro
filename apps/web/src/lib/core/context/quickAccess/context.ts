import { createLazyMemo } from '@solid-primitives/memo';
import {
  type Accessor,
  createContext,
  createSignal,
  useContext,
} from 'solid-js';
import type { Bucket, QuickAccessContextValue, QuickAccessItem } from './types';

const QuickAccessContext = createContext<QuickAccessContextValue>();

export const QuickAccessContextProvider = QuickAccessContext.Provider;

export function useQuickAccess(): QuickAccessContextValue {
  const value = useContext(QuickAccessContext);
  if (!value) {
    throw new Error(
      'QuickAccessContext must be used within <QuickAccessContextProvider />'
    );
  }
  return value;
}

export type RegisterQuickAccessSource = (
  source: QuickAccessContextValue
) => () => void;

export type QuickAccessSourceProps = {
  registerSource: RegisterQuickAccessSource;
};

/**
 * Creates the stable context value exposed to the app while the feature flag
 * swaps the source that powers it. Lists created by already-mounted consumers
 * resolve through the current source instead of pinning the source that was
 * active when `useList` was first called.
 */
export function createQuickAccessContextFacade(): {
  value: QuickAccessContextValue;
  registerSource: RegisterQuickAccessSource;
} {
  const [source, setSource] = createSignal<
    QuickAccessContextValue | undefined
  >();

  const useList = ((...buckets: Bucket[]): Accessor<QuickAccessItem[]> => {
    const sourceLists = new WeakMap<
      QuickAccessContextValue,
      Accessor<QuickAccessItem[]>
    >();

    return createLazyMemo(() => {
      const activeSource = source();
      if (!activeSource) return [];

      let list = sourceLists.get(activeSource);
      if (!list) {
        list = activeSource.useList(...buckets);
        sourceLists.set(activeSource, list);
      }
      return list();
    });
  }) as QuickAccessContextValue['useList'];

  const value: QuickAccessContextValue = {
    useList,
    isLoading: () => source()?.isLoading() ?? true,
    refresh: () => source()?.refresh(),
    getById: (id) => source()?.getById(id),
  };

  const registerSource: RegisterQuickAccessSource = (nextSource) => {
    setSource(nextSource);
    return () => {
      setSource((activeSource) =>
        activeSource === nextSource ? undefined : activeSource
      );
    };
  };

  return { value, registerSource };
}
