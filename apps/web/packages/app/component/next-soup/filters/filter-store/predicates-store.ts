import { createMemo, createSignal } from 'solid-js';

export type FilterPredicate<T> = (entity: T, ctx?: unknown) => boolean;

export type PredicateConfig<T, TId extends string = string> = {
  id: TId;
  predicate: FilterPredicate<T>;
  query?: unknown;
};

type IdInput<TId extends string> = TId | (string & {});

export type SetPredicatesInput<TId extends string> = {
  and?: readonly IdInput<TId>[];
  or?: readonly IdInput<TId>[];
};

type CurrentPredicatesState<TId extends string> = {
  andIds: TId[];
  orIds: TId[];
};

type SetPredicatesCallback<TId extends string> = (
  current: CurrentPredicatesState<TId>
) => SetPredicatesInput<TId>;

type PredicatesStoreOptions<
  T,
  TConfig extends PredicateConfig<T>,
  TId extends string = TConfig['id'],
> = {
  configs: readonly TConfig[];
  initial?: {
    and?: TId[];
    or?: TId[];
  };
};

export function createPredicatesStore<
  T,
  TConfig extends PredicateConfig<T>,
  TId extends string = TConfig['id'],
>(options: PredicatesStoreOptions<T, TConfig, TId>) {
  const { configs, initial = {} } = options;

  const configMap = new Map<string, TConfig>(configs.map((c) => [c.id, c]));

  const validIds = (ids: readonly IdInput<TId>[] | undefined): TId[] =>
    (ids?.filter((id) => configMap.has(id)) as TId[]) ?? [];

  const [andIds, setAndIds] = createSignal<TId[]>(validIds(initial.and));
  const [orIds, setOrIds] = createSignal<TId[]>(validIds(initial.or));

  const activeIds = createMemo(() => [...andIds(), ...orIds()]);

  const activeConfigs = createMemo(() =>
    activeIds()
      .map((id) => configMap.get(id))
      .filter((c): c is TConfig => c !== undefined)
  );

  const getConfig = (id: IdInput<TId>): TConfig | undefined =>
    configMap.get(id);

  const isActive = (id: IdInput<TId>): boolean =>
    activeIds().includes(id as TId);

  const currentState = (): CurrentPredicatesState<TId> => ({
    andIds: andIds(),
    orIds: orIds(),
  });

  const set = (input: SetPredicatesInput<TId> | SetPredicatesCallback<TId>) => {
    const resolved =
      typeof input === 'function' ? input(currentState()) : input;

    setAndIds(validIds(resolved.and));
    setOrIds(validIds(resolved.or));
  };

  const toggleIds = (current: TId[], toToggle: TId[]): TId[] => {
    let result = [...current];

    for (const id of toToggle) {
      if (result.includes(id)) {
        result = result.filter((i) => i !== id);
      } else {
        result.push(id);
      }
    }

    return result;
  };

  const toggle = (
    input: SetPredicatesInput<TId> | SetPredicatesCallback<TId>
  ) => {
    const resolved =
      typeof input === 'function' ? input(currentState()) : input;

    setAndIds((prev) => toggleIds([...prev], validIds(resolved.and)));
    setOrIds((prev) => toggleIds([...prev], validIds(resolved.or)));
  };

  const clear = () => {
    setAndIds([]);
    setOrIds([]);
  };

  const test = (entity: T, ctx?: unknown): boolean => {
    const andList = andIds();
    const orList = orIds();

    if (andList.length === 0 && orList.length === 0) return true;

    for (const id of andList) {
      const config = configMap.get(id);
      if (config && !config.predicate(entity, ctx)) return false;
    }

    if (orList.length > 0) {
      let anyMatch = false;
      for (const id of orList) {
        const config = configMap.get(id);
        if (config?.predicate(entity, ctx)) {
          anyMatch = true;
          break;
        }
      }
      if (!anyMatch) return false;
    }

    return true;
  };

  return {
    andIds,
    orIds,
    activeIds,
    activeConfigs,
    isActive,
    toggle,
    clear,
    set,
    getConfig,
    available: configs,
    test,
  };
}
