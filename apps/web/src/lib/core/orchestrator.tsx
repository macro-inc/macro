import type { Location } from '@solidjs/router';
import type { Mutex } from 'async-mutex';
import {
  type Accessor,
  createEffect,
  createRoot,
  type JSXElement,
  onCleanup,
  onMount,
  Suspense,
  untrack,
} from 'solid-js';
import { createStore, unwrap } from 'solid-js/store';
import { Dynamic } from 'solid-js/web';
import {
  type BlockAlias,
  type BlockAliasContext,
  Block as BlockComponent,
  type BlockComponentProps,
  type BlockName,
  type NestedState,
  ValidNestingCombinations,
} from './block';
import type { BlockMethodsFor } from './blockMethodRegistry';
import { LoadingBlock } from './component/LoadingBlock';
import { blocks as BLOCK_REGISTRY } from './constant/allBlocks';
import { BlockEffectRunner } from './internal/BlockEffectRunner';
import { BlockLoader } from './internal/BlockLoader';
import type { Source } from './source';

type Store<T extends object> = ReturnType<typeof createStore<T>>;

/**
 * A block consists of a type and an id
 */
type Block = {
  type: BlockName;
  id: string;
};

/** Key used to index on the block instace */
type BlockKey = `${BlockName}:${string}`;
const keyOf = (type: BlockName, id: string): BlockKey => `${type}:${id}`;

/** Separates each surface's managed blocks; undefined is the default surface. */
type BlockScope = string | undefined;
const inScope = (scope: BlockScope, key: string) =>
  scope === undefined ? key : `${scope}/${key}`;

function getBlockDefinition(type: BlockName) {
  const definition = BLOCK_REGISTRY[type];
  if (!definition) {
    throw new Error(`Block definition not found for type: ${type}`);
  }
  return definition;
}

type BlockMap = Record<string, Block>;
type BlockMethodCaller<T> = () => Promise<T>;

/**
 * A method on a block exposable to other blocks via the [BlockOrchestrator]
 * TODO: only one person should be able to call a block method at a time
 */
type BlockMethod<T> = {
  method: T;
  mutex: Mutex;
  queue: Array<BlockMethodCaller<T>>;
};

type MethodRegistry<S> = {
  [K in keyof S]?: S[K] extends (...args: any[]) => any
    ? BlockMethod<S[K]>
    : never;
};

type RegisterBlockMethodFn<S> = <K extends keyof S>(
  methodName: K,
  method: S[K]
) => void;
type DeregisterBlockMethodFn<S> = <K extends keyof S>(methodName: K) => void;

/**
 * A privately accessible handle to a block
 * A block can use its own [OwnedBlockHandle] to attach publicly accessible methods
 *
 * NOTE: This handle is meant to be used by the block itself.
 */
export type OwnedBlockHandle<S> = {
  block: Block;
  registry: Store<MethodRegistry<S>>;
  registerMethod: RegisterBlockMethodFn<S>;
  deregisterMethod: DeregisterBlockMethodFn<S>;
};

type BlockInstance = {
  key: string;
  type: BlockName;
  id: string;
  element: () => JSXElement;
  isMounted: () => boolean;
  nested?: NestedState<any>;
  handle: OwnedBlockHandle<any>;
  scope?: BlockScope;
};

type CreateBlockOptions<Name extends BlockName = BlockName> = {
  params?: BlockComponentProps[Name];
  location?: Location;
  nested?: NestedState<any>;
  sourceResolver?: (type: Name, id: string, location?: Location) => Source;
  aliasContext?: BlockAliasContext;
};

type UnmanagedBlockInstance = Omit<
  BlockInstance,
  'handle' | 'isMounted' | 'scope'
>;

/**
 * Creates an unmanaged block instance
 * - An unmanaged block instance does not have a handle.
 * - An unmanaged block instance can't expose external api's to the orchestrator.
 * - An unamanged block instance is not discoverable by the orchestrator.
 * - Calling [createMethodRegistration] within an unmanaged block instance will have no effect.
 * - The called of this method is responsible for cleaning up the block instance.
 * - An unmanaged block has no restrictions on uniqueness. Many unmanaged blocks with the same id and type can exist.
 * - It is the responsibility of the consumer to ensure that this lack of uniqueness is not a problem.
 *
 * NOTE: Use this for Block Previews of block-in-block scenarios
 *
 * @param type - The type of the block
 * @param id - The id of the block
 * @param opts - Options for the block
 * @returns An unmanaged block instance
 */
export function createBlockInstance(
  type: BlockName,
  id: string,
  opts?: CreateBlockOptions
): UnmanagedBlockInstance {
  const definition = getBlockDefinition(type);
  const src = (opts?.sourceResolver ?? defaultSourceResolver)(
    type,
    id,
    opts?.location
  );

  const element = createBlockElement({
    id,
    type,
    definition,
    src,
    opts,
  });

  const instance: UnmanagedBlockInstance = {
    key: keyOf(type, id),
    type,
    id,
    element,
    nested: opts?.nested,
  };

  return instance;
}

/**
 * Creates an function returning a mountable block JSXElement
 * It's recommended to call the returned function inside the scope you want to use it in
 *
 * @param id - The id of the block
 * @param type - The type of the block
 * @param definition - The definition of the block
 * @param src - The source of the block
 * @param ownedHandle - The handle to the block
 * @param opts - Options for the block
 * @param onCleanup - A function to be called when the block is unmounted
 * @param onMount - A function to be called when the block is mounted
 * @returns A function returning a mountable block JSXElement
 */
function createBlockElement({
  id,
  type,
  definition,
  src,
  ownedHandle,
  opts,
  onCleanup: onElementCleanup,
  onMount: onElementMount,
}: {
  id: string;
  type: BlockName;
  definition: any;
  src: Source;
  ownedHandle?: OwnedBlockHandle<any>;
  opts?: CreateBlockOptions;
  onCleanup?: () => void;
  onMount?: () => void;
}): () => JSXElement {
  return () => {
    onMount(() => {
      onElementMount?.();
      console.log(
        'mounting block with id:',
        id,
        'type:',
        type,
        'params:',
        opts?.params
      );
    });

    onCleanup(() => {
      console.log('unmounting block with id:', id, 'type:', type);
      onElementCleanup?.();
    });

    return (
      <BlockComponent
        id={id}
        name={type}
        nested={opts?.nested}
        aliasContext={opts?.aliasContext}
      >
        <BlockLoader
          definition={definition}
          source={src}
          id={id}
          handle={ownedHandle}
        />
        <Suspense
          fallback={<Dynamic component={definition.loading ?? LoadingBlock} />}
        >
          <Dynamic component={definition.component} {...opts?.params} />
        </Suspense>
        <BlockEffectRunner />
      </BlockComponent>
    );
  };
}

/**
 * A handle to a block instance
 * This handle is meant to be consumed by consumers of a block.
 * That might be a layout or a parent block.
 */
export type BlockInstanceHandle = {
  type: BlockName;
  id: string;
};

/**
 * A publicly accessible handle to a block
 * Using this handle, you can call [BlockMethod]s exposed by the block
 *
 * NOTE: This handle is meant to be consumed by other blocks
 */
type BlockHandle<S> = {
  block: Block;
  isMethodAvailable: (methodName: string) => boolean;
  awaitMethodAvailable: (methodName: string, timeout?: number) => Promise<void>;
} & {
  [K in keyof S]: S[K] extends (...args: any[]) => any
    ? (...args: Parameters<S[K]>) => Promise<Awaited<ReturnType<S[K]>>>
    : never;
};

function createBlockHandle<S>(
  block: Block,
  registry: MethodRegistry<S>
): BlockHandle<S> {
  const handler: ProxyHandler<any> = {
    get(_, prop) {
      if (prop === 'block') return block;
      if (prop === 'then' || prop === 'catch' || prop === 'finally')
        return undefined;
      const methodName = prop as keyof S;
      return async (...args: any[]) => {
        await awaitBlockMethodAvailable(registry, methodName as string, 10_000);
        const entry = registry[methodName];
        if (!entry?.method) return;
        return await entry.method(...args);
      };
    },
  };
  const isMethodAvailable = (methodName: keyof S) =>
    !!registry[methodName]?.method;
  const awaitMethodAvailable = (methodName: keyof S, timeout?: number) =>
    awaitCondition(
      () => registry[methodName]?.method !== undefined,
      timeout
    ).catch((e) => console.error('awaitBlockMethodAvailable error', e));
  return new Proxy(
    { block, isMethodAvailable, awaitMethodAvailable },
    handler
  ) as BlockHandle<S>;
}

type BlockWithHandle = Block & {
  handle: OwnedBlockHandle<any>;
};

type BlockWithHandleMap = Record<string, BlockWithHandle>;

type GetBlockHandleFn = {
  <T extends BlockName>(
    blockId: string,
    blockType: T
  ): Promise<BlockHandle<BlockMethodsFor<T>> | undefined>;
  <T extends BlockAlias>(
    blockId: string,
    blockType: T
  ): Promise<BlockHandle<any> | undefined>;
  (blockId: string): Promise<BlockHandle<any> | undefined>;
};

type CreateBlockInstanceFn = (
  type: BlockName,
  id: string,
  opts?: CreateBlockOptions
) => BlockInstance;

export type BlockOrchestrator = {
  /** Whether a managed block is currently mounted in any surface. */
  isBlockMounted: (type: BlockName, id: string) => boolean;
  /** Get a publicly accessible handle to a block instance in the current scope */
  getBlockHandle: GetBlockHandleFn;
  /**
   * Sets the scope that new managed blocks belong to and that handle lookups
   * read, so surfaces shown one at a time (desktop tabs) can each mount the
   * same block.
   */
  setBlockScope: (scope: Accessor<BlockScope>) => void;
  /**
   * Creates a managed block instance
   * - A managed block instance is discoverable by the orchestrator
   * - A managed block instance is "managed" / "owned" by the orchestrator
   * - A managed block instance can expose external api's to the orchestrator
   * - *A managed block instance is unique on type and id within its scope*
   *
   * NOTE: Use this for mounting full blocks, for example in a layout
   * WARN: DO NOT use this for block previews of block-in-block scenarios
   *
   *  @param type - The type of the block
   *  @param id - The id of the block
   *  @param opts - Options for the block
   *  @returns A managed block instance
   */
  createBlockInstance: CreateBlockInstanceFn;
  /**
   * Re-file a mounted instance under a new id, keeping the instance itself
   * alive.
   *
   * For a block whose id is not knowable at mount time: the agent block opens
   * on a client-minted placeholder and learns its real session id when the
   * create resolves (`features/block-agent/context/pending-session.ts`). The
   * mount must survive that — the user is already typing into it — so the
   * registry is re-keyed rather than the block re-created. The element keeps
   * the id it closed over, so `useBlockId()` still reports the placeholder;
   * that is what the block resolves through the pending registry.
   *
   * A no-op when nothing is registered under `fromId`, or when `toId` is
   * already taken.
   */
  rekeyBlockInstance: (type: BlockName, fromId: string, toId: string) => void;
  /**
   * Registers a handle for block content mounted without a block container,
   * such as an entity detail view, so openers that navigate through
   * [getBlockHandle] reach it. The handle is removed when the calling owner
   * is disposed.
   *
   * Returns undefined while another block holds the id.
   */
  registerBlockHandle: <T extends BlockName>(
    type: T,
    id: string
  ) => OwnedBlockHandle<BlockMethodsFor<T>> | undefined;
};

export function createBlockOrchestrator(): BlockOrchestrator {
  const [blocks, setBlocks] = createStore<BlockWithHandleMap>({});
  const instances = new Map<string, BlockInstance>();
  let blockScope: Accessor<BlockScope> = () => undefined;
  // Blocks mount inside memos and effects, which must not rerun on a tab switch.
  const currentScope = () => untrack(blockScope);

  const registerBlock = <T extends BlockName>(
    type: T,
    id: string,
    scope: BlockScope
  ): OwnedBlockHandle<BlockMethodsFor<T>> => {
    const block: Block = { type, id };
    const [registry, setRegistry] = createStore<
      MethodRegistry<BlockMethodsFor<T>>
    >({});
    const ownedHandle: OwnedBlockHandle<BlockMethodsFor<T>> = {
      block,
      registry: [registry, setRegistry],
      registerMethod(methodName, method) {
        setRegistry(methodName as any, { method } as any);
      },
      deregisterMethod(methodName) {
        setRegistry(methodName as any, undefined as any);
      },
    };
    const blockWithHandle: BlockWithHandle = {
      ...block,
      handle: ownedHandle as any,
    };
    setBlocks(inScope(scope, id), blockWithHandle);
    return ownedHandle;
  };

  /** Placeholder id -> the id its instance was re-filed under. */
  const rekeyed = new Map<string, string>();

  const deregisterBlock = (type: BlockName, id: string, scope: BlockScope) => {
    // The element closed over the id it mounted with, so a re-keyed instance
    // asks to be torn down under its placeholder. Follow the move, or the
    // real entry outlives the mount.
    const placeholder = inScope(scope, keyOf(type, id));
    const current = rekeyed.get(placeholder) ?? id;
    rekeyed.delete(placeholder);
    instances.delete(inScope(scope, keyOf(type, current)));
    setBlocks(inScope(scope, current), undefined!);
  };

  const getBlockHandle: GetBlockHandleFn = async function (
    blockId: string,
    blockType?: BlockName | BlockAlias
  ): Promise<BlockHandle<any> | undefined> {
    // Waits for the scope's own instance: a mount in another tab can't take
    // the navigation meant for the view being opened here.
    const entry = inScope(currentScope(), blockId);
    await awaitBlockRegistered(blocks as any, entry);
    const block = (blocks as any)[entry] as BlockWithHandle | undefined;
    if (!block) return;
    if (blockType && block.type !== blockType) {
      console.warn(
        `Block ${blockId} is of type ${block.type}, not ${blockType}`
      );
      return;
    }
    const [registry] = block.handle.registry;
    return createBlockHandle<any>(block, registry);
  };

  function createManagedBlockInstance(
    type: BlockName,
    id: string,
    opts?: CreateBlockOptions
  ): BlockInstance {
    const scope = currentScope();
    const key = inScope(scope, keyOf(type, id));
    const existing = instances.get(key);
    if (existing) return existing;

    const ownedHandle = registerBlock(type, id, scope);

    const definition = getBlockDefinition(type);
    const src = (opts?.sourceResolver ?? defaultSourceResolver)(
      type,
      id,
      opts?.location
    );

    const element = createBlockElement({
      id,
      type,
      definition,
      src,
      ownedHandle,
      opts,
      onCleanup: () => {
        deregisterBlock(type, id, scope);
      },
    });

    let mounted = false;
    const mountOnce = () => {
      if (mounted) {
        return (
          <div class="flex size-full items-center justify-center text-sm text-ink-muted">
            Content already open.
          </div>
        );
      }

      mounted = true;
      onCleanup(() => {
        mounted = false;
      });
      return element();
    };

    const instance: BlockInstance = {
      key,
      type,
      id,
      element: mountOnce,
      isMounted: () => mounted,
      nested: opts?.nested,
      handle: ownedHandle,
      scope,
    };

    instances.set(key, instance);
    return instance;
  }

  function rekeyBlockInstance(type: BlockName, fromId: string, toId: string) {
    if (fromId === toId) return;
    // The create can resolve after its tab went to the background, so the
    // instance is not necessarily in the current scope.
    const moving = [...instances.values()].filter(
      (instance) => instance.type === type && instance.id === fromId
    );
    for (const instance of moving) {
      const { scope } = instance;
      const from = inScope(scope, keyOf(type, fromId));
      const to = inScope(scope, keyOf(type, toId));
      if (instances.has(to)) continue;

      instances.delete(from);
      instances.set(to, { ...instance, key: to, id: toId });
      rekeyed.set(from, toId);

      // The handle's `block.id` is what `getBlockHandle` resolves and what
      // method registrations are looked up by, so it moves with the instance.
      const fromEntry = inScope(scope, fromId);
      const existing = (blocks as any)[fromEntry] as
        | BlockWithHandle
        | undefined;
      if (!existing) continue;
      setBlocks(fromEntry, undefined!);
      setBlocks(inScope(scope, toId), { ...existing, id: toId });
    }
  }

  function registerBlockHandle<T extends BlockName>(type: T, id: string) {
    const scope = currentScope();
    const entry = inScope(scope, id);
    if (unwrap(blocks)[entry]) return;
    const handle = registerBlock(type, id, scope);
    onCleanup(() => {
      if (unwrap(blocks)[entry]?.handle === handle)
        setBlocks(entry, undefined!);
    });
    return handle;
  }

  return {
    isBlockMounted: (type, id) =>
      instances.get(inScope(currentScope(), keyOf(type, id)))?.isMounted() ??
      false,
    getBlockHandle,
    setBlockScope(scope) {
      blockScope = scope;
    },
    createBlockInstance: createManagedBlockInstance,
    rekeyBlockInstance,
    registerBlockHandle,
  };
}

type MakeOptionalAsyncMethod<T> = {
  [K in keyof T]: T[K] extends (...args: infer A) => Promise<infer R>
    ? (...args: A) => R | Promise<R>
    : T[K] extends (...args: infer A) => infer R
      ? (...args: A) => R | Promise<R>
      : T[K];
};

export function createMethodRegistration<T extends BlockName>(
  ownedBlockHandle: Accessor<OwnedBlockHandle<BlockMethodsFor<T>> | undefined>,
  registerFns: Partial<MakeOptionalAsyncMethod<BlockMethodsFor<T>>>
): void {
  createEffect(() => {
    const handle = ownedBlockHandle();
    if (!handle) return;
    for (const [methodName, method] of Object.entries(registerFns)) {
      if (method)
        handle.registerMethod(
          methodName as keyof BlockMethodsFor<T>,
          method as any
        );
    }
  });
  onCleanup(() => {
    const handle = ownedBlockHandle();
    if (!handle) return;
    for (const methodName of Object.keys(registerFns)) {
      handle.deregisterMethod(methodName as keyof BlockMethodsFor<T>);
    }
  });
}

type DefaultLocation = Location<{ upload?: File }>;
function defaultSourceResolver(
  type: BlockName,
  id: string,
  location?: DefaultLocation
): Source {
  const def = BLOCK_REGISTRY[type];
  if (!def) {
    console.warn(`Block definition not found for type: ${type} with id: ${id}`);
  }
  if (def?.syncServiceEnabled) return { type: 'sync-service', id };
  return {
    type: 'dss',
    id,
    name: location?.state?.upload?.name,
    upload: location?.state?.upload,
  };
}

const DEFAULT_TIMEOUT = 5_000;

export function awaitCondition(
  condition: () => boolean,
  timeoutMs = DEFAULT_TIMEOUT
): Promise<void> {
  if (condition()) return Promise.resolve();
  return new Promise((resolve, reject) => {
    createRoot((dispose) => {
      const timer = setTimeout(() => {
        if (condition()) return resolve();
        else reject(new Error('Timeout'));
        dispose();
      }, timeoutMs);
      createEffect(() => {
        if (condition()) {
          clearTimeout(timer);
          dispose();
          resolve();
        }
      });
    });
  });
}

const awaitBlockRegistered = (blocks: BlockMap, id: string, timeout?: number) =>
  awaitCondition(() => blocks[id] !== undefined, timeout).catch((e) =>
    console.error('awaitBlockRegistered', e)
  );

const awaitBlockMethodAvailable = (
  registry: MethodRegistry<any>,
  method: string,
  timeout?: number
) =>
  awaitCondition(() => registry[method]?.method !== undefined, timeout).catch(
    (e) => console.error('awaitMethod', e)
  );

export const canNestBlock = (
  name: BlockName,
  parentName?: BlockName
): boolean => {
  if (!parentName) return false;
  return ValidNestingCombinations[name].has(parentName);
};
