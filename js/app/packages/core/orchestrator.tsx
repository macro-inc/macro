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
} from 'solid-js';
import { createStore } from 'solid-js/store';
import {
  Block as BlockComponent,
  type BlockName,
  type NestedState,
  ValidNestingCombinations,
} from './block';
import type { BlockMethodsFor } from './blockMethodRegistry';
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
  nested?: NestedState<any>;
  handle: OwnedBlockHandle<any>;
};

export type CreateBlockOptions = {
  location?: Location;
  nested?: NestedState<any>;
  sourceResolver?: (type: BlockName, id: string, location?: Location) => Source;
};

type UnmanagedBlockInstance = Omit<BlockInstance, 'handle'>;

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
  const definition = BLOCK_REGISTRY[type];
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
      console.log('mounting block with id:', id, 'type:', type);
    });

    onCleanup(() => {
      console.log('unmounting block with id:', id, 'type:', type);
      onElementCleanup?.();
    });

    return (
      <BlockComponent id={id} name={type} nested={opts?.nested}>
        <BlockLoader
          definition={definition}
          source={src}
          id={id}
          handle={ownedHandle}
        />
        <Suspense>
          <definition.component {...(opts?.nested?.initArgs ?? {})} />
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
export type BlockHandle<S> = {
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
  (blockId: string): Promise<BlockHandle<any> | undefined>;
};

type CreateBlockInstanceFn = (
  type: BlockName,
  id: string,
  opts?: CreateBlockOptions
) => BlockInstance;

export type BlockOrchestrator = {
  /** Get a publicly accessible handle to a block instance */
  getBlockHandle: GetBlockHandleFn;
  /**
   * Creates a managed block instance
   * - A managed block instance is discoverable by the orchestrator
   * - A managed block instance is "managed" / "owned" by the orchestrator
   * - A managed block instance can expose external api's to the orchestrator
   * - *A managed block instance is unique on type and id*
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
};

export function createBlockOrchestrator(): BlockOrchestrator {
  const [blocks, setBlocks] = createStore<BlockWithHandleMap>({});
  const instances = new Map<string, BlockInstance>();

  const registerBlock = <T extends BlockName>(
    type: T,
    id: string
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
    setBlocks(id, blockWithHandle);
    return ownedHandle;
  };

  const deregisterBlock = (type: BlockName, id: string) => {
    instances.delete(keyOf(type, id));
    setBlocks(id, undefined!);
  };

  const getBlockHandle: GetBlockHandleFn = async function <T extends BlockName>(
    blockId: string,
    blockType?: T
  ): Promise<BlockHandle<BlockMethodsFor<T>> | undefined> {
    await awaitBlockRegistered(blocks as any, blockId);
    const block = (blocks as any)[blockId] as BlockWithHandle | undefined;
    if (!block) return;
    if (blockType && block.type !== blockType) {
      console.warn(
        `Block ${blockId} is of type ${block.type}, not ${blockType}`
      );
      return;
    }
    const [registry] = block.handle.registry;
    return createBlockHandle<BlockMethodsFor<T>>(block, registry);
  };

  function createManagedBlockInstance(
    type: BlockName,
    id: string,
    opts?: CreateBlockOptions
  ): BlockInstance {
    const key = keyOf(type, id);
    let existing = instances.get(key);
    if (existing) return existing;

    const ownedHandle = registerBlock(type, id);

    const definition = BLOCK_REGISTRY[type];
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
        deregisterBlock(type, id);
      },
    });

    const instance: BlockInstance = {
      key,
      type,
      id,
      element,
      nested: opts?.nested,
      handle: ownedHandle,
    };

    instances.set(key, instance);
    return instance;
  }

  return {
    getBlockHandle,
    createBlockInstance: createManagedBlockInstance,
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
  if (def.syncServiceEnabled) return { type: 'sync-service', id };
  return {
    type: 'dss',
    id,
    name: location?.state?.upload?.name,
    upload: location?.state?.upload,
  };
}

const DEFAULT_TIMEOUT = 5_000;

function awaitCondition(
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
