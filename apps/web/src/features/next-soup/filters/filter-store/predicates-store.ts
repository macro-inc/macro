import { createMemo, createSignal } from 'solid-js';

export type FilterPredicate<T, TContext = unknown> = (
  entity: T,
  ctx: TContext
) => boolean;

export type PredicateConfig<
  T,
  TId extends string = string,
  TContext = unknown,
> = {
  id: TId;
  predicate: FilterPredicate<T, TContext>;
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
  TContext,
  TConfig extends PredicateConfig<T, string, TContext>,
  TId extends string = TConfig['id'],
> = {
  configs: readonly TConfig[];
  initial?: {
    and?: TId[];
    or?: TId[];
  };
};

function matchesPredicates<T, TContext>(
  configMap: ReadonlyMap<string, PredicateConfig<T, string, TContext>>,
  andList: readonly string[],
  orList: readonly string[],
  entity: T,
  ctx: TContext
): boolean {
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
}

// Built at module scope: a closure made inside the store would share the
// store's scope, owner included.
function predicatesSnapshot<T, TContext>(
  configMap: ReadonlyMap<string, PredicateConfig<T, string, TContext>>,
  andList: readonly string[],
  orList: readonly string[]
): FilterPredicate<T, TContext> {
  return (entity, ctx) =>
    matchesPredicates(configMap, andList, orList, entity, ctx);
}

export function createPredicatesStore<
  T,
  TContext,
  TConfig extends PredicateConfig<T, string, TContext>,
  TId extends string = TConfig['id'],
>(options: PredicatesStoreOptions<T, TContext, TConfig, TId>) {
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

  const test = (entity: T, ctx: TContext): boolean =>
    matchesPredicates(configMap, andIds(), orIds(), entity, ctx);

  /**
   * `test` over the predicates active now. It holds no reactive state, so a
   * cached query's options can keep it without keeping this store's owner,
   * and with it the view, alive.
   */
  const snapshotTest = (): FilterPredicate<T, TContext> =>
    predicatesSnapshot(configMap, andIds(), orIds());

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
    snapshotTest,
  };
}
