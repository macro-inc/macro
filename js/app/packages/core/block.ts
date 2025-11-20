import type { BlockCanvasProps } from '@block-canvas/component/Block';
import type { IDocumentStorageServiceFile } from '@filesystem/file';
import type { AccessLevel } from '@service-storage/generated/schemas/accessLevel';
import type { DocumentMetadata } from '@service-storage/generated/schemas/documentMetadata';
import type { GetDocumentResponseData } from '@service-storage/generated/schemas/getDocumentResponseData';
import type { Project } from '@service-storage/generated/schemas/project';
import type {
  Accessor,
  Component,
  FlowProps,
  InitializedResource,
  InitializedResourceOptions,
  lazy,
  Owner,
  Resource,
  ResourceActions,
  ResourceFetcher,
  ResourceOptions,
  ResourceSource,
  Setter,
  SignalOptions,
} from 'solid-js';
import {
  createComponent,
  createContext,
  createResource,
  createSignal,
  getOwner,
  onCleanup,
  useContext,
} from 'solid-js';
import { createStore, type SetStoreFunction, type Store } from 'solid-js/store';
import { ENABLE_PDF_MULTISPLIT } from './constant/featureFlags';
import { blockDataSignal } from './internal/BlockLoader';
import type { Source, SourcePreload } from './source';
import {
  err,
  isErr,
  type MaybeResult,
  type ObjectLike,
} from './util/maybeResult';

/**
 * List of valid block types that can be used in the application.
 */
export const BlockRegistry = [
  'chat',
  'write',
  'pdf',
  'md',
  'code',
  'image',
  'canvas',
  'channel',
  'project',
  'unknown',
  'video',
  'email',
  'contact',
] as const;

type BlockNameKeys = keyof typeof BlockRegistry & number;

/**
 * Represents a block name which is one of the predefined block types in {@link BlockRegistry}.
 */
export type BlockName = (typeof BlockRegistry)[BlockNameKeys];

/**
 * Represents the block types that do not correspond to a document type.
 */
export const NonDocumentBlockTypes = [
  'chat',
  'channel',
  'project',
  'email',
  'contact',
] as BlockName[];

/**
 * Represents the type of a possible 2-block combination used in split layouts.
 * The key is block on the left of the the split and the value is a set of
 * allowed blocks on the right.
 */
export type BlockCombinationRules = {
  [Key in BlockName]: Set<BlockName>;
};

export type PreviewState = {
  canvas?: {
    onLocationChange?: (location: {
      x: number;
      y: number;
      scale: number;
    }) => void;
  };
};

export type NestedState<Name extends BlockName> = {
  parentId?: string;
  parentName?: Name;
  parentContext?: PreviewState;
  initArgs?: BlockComponentProps[Name];
};

const allBlockNames = new Set([...BlockRegistry]);
function exclude(excludeSet: BlockName[]) {
  return new Set(BlockRegistry.filter((x) => !excludeSet.includes(x)));
}
/**
 * Defines the block combinations that are valid.
 */
export const ValidBlockCombinations: BlockCombinationRules = {
  chat: allBlockNames,
  pdf: ENABLE_PDF_MULTISPLIT ? allBlockNames : exclude(['pdf']),
  write: exclude(['write']),
  md: allBlockNames,
  code: exclude(['code']),
  image: allBlockNames,
  channel: allBlockNames,
  email: allBlockNames,
  canvas: allBlockNames,
  project: allBlockNames,
  unknown: allBlockNames,
  video: allBlockNames,
  contact: allBlockNames,
} as const;

// maps block name to valid parents
export const ValidNestingCombinations: BlockCombinationRules = {
  canvas: new Set(['md']),
  chat: new Set([]),
  pdf: new Set(['md']),
  write: new Set([]),
  md: new Set([]),
  code: new Set(['md']),
  image: new Set([]),
  channel: new Set([]),
  email: new Set([]),
  project: new Set([]),
  unknown: new Set([]),
  video: new Set([]),
  contact: new Set([]),
};

export const LoadErrors = {
  UNAUTHORIZED: err('UNAUTHORIZED', 'Unauthorized access'),
  MISSING: err('MISSING', 'Not found'),
  INVALID: err('INVALID', 'Unable to load invalid document'),
  GONE: err('GONE', 'Document no longer exists'),
} as const;

type LoadErrorCodes = keyof typeof LoadErrors;

/**
 * Converts a MaybeResult to a MaybeResult with a load error code.
 * @template T - The type of the input result value.
 * @param {MaybeResult<string, T>} maybeResult - The result to convert.
 * @returns {MaybeResult<keyof typeof LoadErrors, T>} A new MaybeResult with a load error code.
 */
export function toLoadResult<E extends string, T extends ObjectLike>(
  maybeResult: MaybeResult<E, T>
): MaybeResult<keyof typeof LoadErrors, T> {
  if (isErr(maybeResult, 'GONE')) return LoadErrors.GONE;
  if (isErr(maybeResult, 'UNAUTHORIZED')) return LoadErrors.UNAUTHORIZED;
  if (isErr(maybeResult, 'NOT_FOUND')) return LoadErrors.MISSING;
  if (isErr(maybeResult)) return LoadErrors.INVALID;
  return maybeResult;
}

/**
 * Awaits a load result and returns a new load result with the same value or a load error.
 * @template T - The type of the input result value.
 * @param {Promise<MaybeResult<string, T>>} result - The result to await.
 * @returns {Promise<MaybeResult<keyof typeof LoadErrors, T>>} A new MaybeResult with the same value or a load error.
 */
export async function loadResult<
  T extends Promise<MaybeResult<string, ObjectLike>>,
>(
  result: T
): Promise<
  MaybeResult<keyof typeof LoadErrors, ExtractSuccessType<Awaited<T>>>
> {
  return toLoadResult(await result) as any; // any because TypeScript gets confused and loses the ObjectLike's specific type
}

/**
 * Maps over an ok result, or passes through a load error.
 * @template T - The type of the input result value.
 * @template U - The type of the output result value.
 * @param {MaybeResult<string, T>} result - The result to map.
 * @param {(value: T) => U} fn - The function to apply to the ok value.
 * @returns {MaybeResult<LoadErrorCodes, U>} A new MaybeResult with the mapped value or a load error.
 */
export function mapLoadResult<T extends ObjectLike, U extends ObjectLike>(
  result: MaybeResult<string, T>,
  fn: (value: T) => U
): MaybeResult<LoadErrorCodes, U> {
  const [error, data] = toLoadResult(result);
  if (error) return [error, null];
  return [null, fn(data)];
}

// Magic type that when used at sites where generic types are inferred from, will prevent those sites from being involved in the inference.
// https://github.com/microsoft/TypeScript/issues/14829
// TypeScript Discord conversation: https://discord.com/channels/508357248330760243/508357248330760249/911266491024949328
export type NoInfer<T> = [T][T extends any ? 0 : never];

export type FileLike = { file: Blob } & GetDocumentResponseData;
export type TextLike = { text: string } & GetDocumentResponseData;
export type FileOrTextLike = FileLike | TextLike;

// RoutePreloadFuncArgs['intent'] from '@solidjs/router';
type Intent = 'initial' | 'native' | 'navigate' | 'preload';
/**
 * A function type that returns a resource for the given data type.
 *
 * @template T - The data type being used.
 * @param {Source} [source] - Source to be used with the resource.
 * @returns {Promise<T>} - The data type tied to the block type.
 */
export type LoadFunction<
  T extends ObjectLike,
  P extends SourcePreload<Record<string, any>>,
  S extends Source | P = Source | P,
> = (
  source: NoInfer<S>,
  intent: Intent
) => Promise<
  MaybeResult<keyof typeof LoadErrors, S extends Source ? T | P : T>
>;

type ExtractSuccessType<T> = T extends [null, infer S]
  ? Exclude<S, SourcePreload<{}>>
  : never;

/**
 * Extracts the non-error, non-preload return type of a load function.
 *
 * This utility type unwraps the Promise, extracts the success type from MaybeResult,
 * and excludes the SourcePreload type. It's useful for getting the actual data type
 * returned by a load function in the successful, non-preload case.
 *
 * @template T - The type of the load function, which should extend LoadFunction<any>.
 * @returns The extracted data type from the load function's return type.
 *
 * @example
 * const definition = defineBlock({
 *   // ... other properties ...
 *   async load(source, intent) {
 *     // Implementation that returns Promise<MaybeResult<Error, Data | Preload>>
 *   },
 * });
 *
 * type WriterData = ExtractLoadDataType<typeof definition['load']>;
 * // WriterData will be the type of 'Data' in the successful, non-preload case
 */
export type ExtractLoadType<T extends LoadFunction<any, any>> =
  ExtractSuccessType<Awaited<ReturnType<T>>>;

interface BlockComponentProps extends Record<BlockName, ObjectLike> {
  canvas: BlockCanvasProps;
}

interface BlockComponentLoadData extends Record<BlockName, ObjectLike> {
  canvas: DocumentBlockData & DssFileData;
  pdf: DocumentBlockData;
  video: DocumentBlockData;
  md: DocumentBlockData & DssFileData;
  code: DocumentBlockData;
  project: ProjectBlockData;
  // TODO: uncomment when email block is ready, it is currently using unknown
  // unknown: DocumentBlockData;
  image: DocumentBlockData & DssFileData;
}

/**
 * A component type representing a block.
 *
 * Note that it intentionally does not take any props. This is because block data should be
 * context-based and rely on a {@link LoadFunction}
 */
export type BlockComponent<Name extends BlockName> =
  | ReturnType<typeof lazy<Component<BlockComponentProps[Name]>>>
  | (Component<BlockComponentProps[Name]> & { preload?: undefined });

export type FileTypeString = string & {};
export type MimeType = string & {};

/**
 * Defines a block and its associated metadata and behavior.
 *
 * @template Service - The service associated with this block.
 * @template Data - The data type used by the block.
 * @template Name - The specific block name from the {@link BlockName} type.
 */
export type BlockDefinition<
  Data extends ObjectLike,
  Name extends BlockName,
  P extends SourcePreload<Record<string, any>>,
  L extends LoadFunction<Data, P>,
> = {
  /** The name of the block. */
  name: Name;

  /** A brief description of what the block does. */
  description: string;
  /** Function to retrieve the data resource for this block. */
  load: L;

  /** The component for the block. */
  component: BlockComponent<Name>;

  /** flag to indicate wether this block should enable collaborative features. */
  liveTrackingEnabled?: boolean;

  accepted: Record<string, string>;

  /** The default name of the file when creating a new block of this type. */
  defaultFilename?: string;

  syncServiceEnabled?: boolean;

  editPermissionEnabled?: boolean;
};

export type AnyBlockDefinition = BlockDefinition<any, any, any, any>;

type DocumentBlockData = {
  userAccessLevel: AccessLevel;
  documentMetadata: DocumentMetadata;
};

type ProjectBlockData = {
  projectMetadata: Project;
  userAccessLevel: AccessLevel;
};

type DssFileData = {
  dssFile: IDocumentStorageServiceFile;
};

/**
 * Defines a block.
 *
 * @template S - The service associated with the block.
 * @template D - The data type used by the block.
 * @template N - The specific block name from the {@link BlockName} type.
 * @param {BlockDefinition<S, D, N>} blockDef - The block definition to be returned.
 * @returns {BlockDefinition<S, D, N>} - The same block definition passed in.
 */
export function defineBlock<
  N extends BlockName,
  D extends BlockComponentLoadData[N],
  P extends SourcePreload<Record<string, any>>,
  L extends LoadFunction<D, P>,
>(blockDef: BlockDefinition<D, N, P, L>): BlockDefinition<D, N, P, L> {
  return blockDef as any;
}

/**
 * Represents a function that can be used as a block effect.
 */
export type BlockEffect = (...args: any[]) => any;

/**
 * After the the render phase, automatically reruns the function whenever the block's signal and
 * store dependencies update.
 *
 * Should only be defined at the top level of a module.
 *
 * @param {BlockEffect} fn - The function to be used as a block effect.
 */
export const [globalBlockEffects] = createSignal<BlockEffect[]>([]);
export const [globalBlockRenderEffects] = createSignal<BlockEffect[]>([]);

export function createBlockEffect(fn: BlockEffect): void {
  globalBlockEffects().push(fn);
}

export function createBlockRenderEffect(fn: BlockEffect): void {
  globalBlockRenderEffects().push(fn);
}

/**
 * A component that provides the scope and context for blocks, including signals, stores, and effects.
 */
export const Block = <Name extends BlockName>(
  props: FlowProps<{ id: string; name: Name; nested?: NestedState<Name> }>
) => {
  const [state] = createSignal<BlockState>({
    entities: new Map(),
    memos: new Map(),
    id: props.id,
    name: props.name,
    nested: props.nested,
    owner: getOwner(),
  });

  onCleanup(() => {
    state().entities.clear();
    state().memos.clear();
  });

  const blockComponent = createComponent(BlockContext.Provider, {
    get value() {
      return state();
    },
    get children() {
      return props.children;
    },
  });

  return blockComponent;
};

/**
 * Hook to access the current block's ID.
 * This will throw if used outside a Block component.
 * @throws {Error} When used outside of a Block context
 * @returns The current block ID
 */
export const useBlockId = (): string => {
  const context = useContext(BlockContext);
  if (!context) {
    throw new Error('hook must be used within a Block component');
  }
  return context.id;
};

export const useIsNestedBlock = (): boolean => {
  const context = useContext(BlockContext);
  if (!context) {
    throw new Error('hook must be used within a Block component');
  }
  return context.nested !== undefined;
};

export const useBlockNestedContext = <Name extends BlockName>():
  | NestedState<Name>
  | undefined => {
  const context = useContext(BlockContext);
  return context?.nested as NestedState<Name>;
};

export const useBlockOwner = (): Owner | null => {
  const context = useContext(BlockContext);
  if (!context) {
    return null;
  }
  return context.owner;
};

/**
 * Hook to access the current block's ID.
 * This will throw if used outside a Block component.
 * @throws {Error} When used outside of a Block context
 * @returns The current block ID
 */
export const useBlockName = (): BlockName => {
  const context = useContext(BlockContext);
  if (!context) {
    throw new Error('hook must be used within a Block component');
  }
  return context.name;
};

/**
 * Use the blockId hook without throwing. Must check for undefined.
 * Useful for testing the markdown engine outside of a block.
 * @returns The current block ID or undefined if not in a block
 */
export const useMaybeBlockId = (): string | undefined => {
  const context = useContext(BlockContext);
  if (!context) {
    return;
  }
  return context.id;
};

/**
 * Use the blockName hook without throwing. Must check for undefined.
 * Useful for testing the markdown engine outside of a block.
 * @returns The current block name or undefined if not in a block
 */
export const useMaybeBlockName = (): BlockName | undefined => {
  const context = useContext(BlockContext);
  if (!context) {
    return;
  }
  return context.name;
};

function styledConsoleError(message: string, code: string) {
  if (import.meta.env.DEV) {
    const styles = `
    color: #f8f8f2;
    background-color: #272822;
    display: inline-block;
    width: 100%;
    font-family: monospace;
    line-height: 1.5;
  `;

    const formattedCode = code.replace(/\n/g, '\n    ');

    console.error(`${message}\n%c    ${formattedCode}`, styles);
  }
}

function buildBlockAccessError(kind: string) {
  return [
    `Unable to access block
If you are using block signal in an async method or component, you need to destructure ${kind} before a return or callback or the first \`await\`:
`,
    `function Component() {
// getter and setter
const [get, set] = someBlockSignal;
// setter
const setAnother = anotherBlockSignal.set;
// getter
const getAnother = anotherBlockSignal.get;

createEffect(() => {
  if (get() !== getAnother()) {
    setAnother(get());
  }
})

return (
  <button onClick={() => setAnother('reset!')}>
    Reset
  </button>
);
}

async function refreshSize() {
  // destructured
  const setSize = sizeSignal.set;
  // the first await
  const currentSize = await doc.calculateSize();
  setSize(currentSize);
}

createBlockEffect(() => {
  refreshSize();
});
`,
  ];
}

let longErrorOnce = [false, false];

function createBlockEntity<T extends any[], R extends [any, any]>(
  this: any,
  creator: Creator<T, R>,
  ...initialArgs: T
) {
  const key = Symbol();

  const getEntry = (): R | undefined => {
    const context =
      useContext(BlockContext) ?? (isInBlockFn(this) ? this.block : undefined);
    if (!context) {
      return undefined;
    }

    let entry = context.entities.get(key);
    if (!entry) {
      const clonedArgs = initialArgs.map((arg) =>
        typeof arg === 'object' && arg !== null ? structuredClone(arg) : arg
      );
      entry = creator(...(clonedArgs as T));
      context.entities.set(key, entry);
    }
    return entry as R;
  };

  return new Proxy(() => {}, {
    get(_target, prop) {
      const entry = getEntry();

      // DEBUG HELPING CODE: {
      if (!entry) {
        if (import.meta.env.DEV) {
          const kind = ['0', 'get'].includes(prop as string)
            ? 'the getter'
            : ['1', 'set'].includes(prop as string)
              ? 'the setter'
              : '';
          if (longErrorOnce[0]) {
            console.error(`Unable to access block
If you are using block signal in an async method or component, you need to destructure ${kind} before a return or callback or the first \`await\``);
            return;
          }
          longErrorOnce[0] = true;

          const [errorMessage, code] = buildBlockAccessError(kind);

          styledConsoleError(errorMessage, code);
        }
        return;
      }
      // DEBUG HELPING CODE: }

      if (prop === '0') return entry[0];
      if (prop === '1') return entry[1];
      if (prop === 'get') return entry[0];
      if (prop === 'set') return entry[1];
      if (prop === Symbol.iterator) {
        return function* () {
          yield entry[0];
          yield entry[1];
        };
      }
      return undefined;
    },
    apply(_target, thisArg, argumentsList) {
      const entry = getEntry();

      // DEBUG HELPING CODE: {
      if (!entry) {
        if (import.meta.env.DEV) {
          if (longErrorOnce[1]) {
            console.error(`Unable to access block
If you are calling a block signal directly in an async method, you need to destructure the getter before the first \`await\``);
            console.trace();
            return;
          }
          longErrorOnce[1] = true;
          styledConsoleError(
            `Unable to access block
If you are calling a block signal directly in an async method, you need to destructure the getter before the first \`await\` or wrap the callback in \`createCallback\`:
`,
            `async function refreshSize() {
  const setSize = sizeSignal.set;
  const currentSize = await doc.calculateSize();
  setSize(currentSize);
}
`
          );
          console.trace();
        }
        return;
      }
      // DEBUG HELPING CODE: }

      return entry[0].apply(thisArg, argumentsList);
    },
  }) as unknown as R[0] & {
    0: R[0];
    1: R[1];
    [Symbol.iterator]: () => IterableIterator<R[0] | R[1]>;
  };
}

export type BlockSignal<T> = [get: Accessor<T>, set: Setter<T>] & {
  (): T;
  get: Accessor<T>;
  set: Setter<T>;
};

/**
 * Creates a block-scoped signal to set and get state.
 *
 * Should only be defined at the top level of a module.
 *
 * @template T - The type of the signal value.
 * @returns {BlockSignal<T | undefined>} A block signal object.
 *
 * @example
 * const nameSignal = createBlockSignal('Macro');
 *
 * // traditional signal usage
 * function Organization() {
 *  const [name, setName] = nameSignal;
 *
 *  return (
 *    <>
 *    <div>Name: {name()}</div>
 *    <button onclick={() => setName('Micro')}>Change Name</button>
 *    </>
 *  )
 * }
 *
 * // derived signal
 * const nameLength = () => nameSignal().length
 *
 * // simpler setter, direct accessor
 * function Organization() {
 *  // to assign context scope, it must be assigned
 *  const setName = nameSignal.set;
 *
 *  return (
 *    <>
 *    <div>Name: {nameSignal()}</div>
 *    <button onclick={() => setName('Micro')}>Change Name</button>
 *    </>
 *  )
 * }
 */
export function createBlockSignal<T>(): BlockSignal<T | undefined>;
export function createBlockSignal<T>(
  value: T,
  options?: SignalOptions<T>
): BlockSignal<T>;
export function createBlockSignal<T>(
  value?: T,
  options?: SignalOptions<T>
): BlockSignal<T | undefined> {
  return createBlockEntity(createSignal, value, options as any) as BlockSignal<
    T | undefined
  >;
}

export type BlockStore<T> = [Store<T>, SetStoreFunction<T>] & {
  (): T;
  get: Store<T>;
  set: SetStoreFunction<T>;
};

/**
 * Creates a block-scoped store to set and get state.
 *
 * Should only be defined at the top level of a module.
 *
 * @template T - The type of the store value, must be an object.
 * @param {T} initialValue - The initial value for the store.
 * @returns {BlockStore<T>} A block store object.
 *
 * @example
 *
 * // traditional usage
 * function UserInfo() {
 *   const [user, setUser] = userStore;
 *   createEffect(() => {
 *     console.log(user.name, 'is', user.age, 'years old');
 *   });
 *   return (
 *     <div>
 *       <p>
 *         User: {user.name} (Age: {user.age})
 *       </p>
 *       <button onClick={() => setUser('name', 'Bob')}>Set Name to Bob</button>
 *       <button onClick={() => setUser('age', (a) => a + 1)}>
 *         Increment Age
 *       </button>
 *     </div>
 *   );
 * }
 *
 * // simpler setter
 * function UserUpdate() {
 *   const setUser = userStore.set;
 *   return (
 *     <div>
 *       <button onClick={() => setUser('name', 'Alice')}>
 *         Set Name to Alice
 *       </button>
 *     </div>
 *   );
 * }
 */
export function createBlockStore<T extends object>(
  initialValue: T
): BlockStore<T> {
  return createBlockEntity(createStore, structuredClone(initialValue)) as any;
}

export type BlockInitializedResource<T, R = unknown> = [
  get: InitializedResource<T>,
  set: ResourceActions<T, R>,
] & {
  (): T;
  get: InitializedResource<T>;
  set: ResourceActions<T, R>;
};

export type BlockResource<T, R = unknown> = [
  get: Resource<T>,
  set: ResourceActions<T, R>,
] & {
  (): T;
  get: Resource<T>;
  set: ResourceActions<T, R>;
};

/**
 * Creates a block-scoped resource that wraps a promise in a reactive pattern.
 *
 * Should only be defined at the top level of a module.
 *
 * @template T - The type of the resource value.
 * @template S - The type of the source value (optional).
 * @template R - The type of the refetching value (optional).
 *
 * @param {ResourceFetcher<S, T, R>} fetcher - Function that returns a value or a Promise.
 * @param {ResourceOptions<T, S>} [options] - Optional configuration for the resource.
 *
 * @returns {BlockResource<T, R>} A block resource object.
 *
 * @example
 * // Without source
 * const userResource = createBlockResource(fetchUser);
 *
 * function UserProfile() {
 *   const user = userResource();
 *   return (
 *     <Show when={!user.loading} fallback={<div>Loading...</div>}>
 *       <div>Name: {user().name}</div>
 *     </Show>
 *   );
 * }
 *
 * // With source and mutate
 * const userIdSignal = createBlockSignal(1);
 * const userResource = createBlockResource(userIdSignal, fetchUserById);
 *
 * function UserManager() {
 *   const userId = userIdSignal();
 *   const [user, { mutate, refetch }] = userResource;
 *
 *   return (
 *     <>
 *       <div>Current User: {user()?.name}</div>
 *       <button onClick={() => userIdSignal.set(userId() + 1)}>Next User</button>
 *       <button onClick={() => mutate({ ...user(), name: 'Updated Name' })}>Update Name</button>
 *       <button onClick={() => refetch()}>Refresh</button>
 *     </>
 *   );
 * }
 */
export function createBlockResource<T, R = unknown>(
  fetcher: ResourceFetcher<true, T, R>,
  options: InitializedResourceOptions<NoInfer<T>, true>
): BlockInitializedResource<T, R>;
export function createBlockResource<T, R = unknown>(
  fetcher: ResourceFetcher<true, T, R>,
  options?: ResourceOptions<NoInfer<T>, true>
): BlockResource<T, R>;
export function createBlockResource<T, S, R = unknown>(
  source: ResourceSource<S>,
  fetcher: ResourceFetcher<S, T, R>,
  options: InitializedResourceOptions<NoInfer<T>, S>
): BlockInitializedResource<T, R>;
export function createBlockResource<T, S, R = unknown>(
  source: ResourceSource<S>,
  fetcher: ResourceFetcher<S, T, R>,
  options?: ResourceOptions<NoInfer<T>, S>
): BlockResource<T, R>;
export function createBlockResource<T, S, R>(
  pSource: ResourceSource<S> | ResourceFetcher<S, T, R>,
  pFetcher?: ResourceFetcher<S, T, R> | ResourceOptions<T, S>,
  pOptions?: ResourceOptions<T, S> | undefined
): BlockResource<T, R> {
  return createBlockEntity(
    createResource,
    pSource,
    pFetcher as any,
    pOptions as any
  ) as any;
}

export type BlockMemo<T> = Accessor<T>;

/**
 * Creates a block-scoped memo that derives a value from other reactive dependencies.
 *
 * The memo provides referential stability, which is crucial when working with arrays or objects
 * that are derived from multiple reactive sources.
 *
 * Should only be defined at the top level of a module.
 *
 * @template T - The type of the memo value.
 * @param {() => T} fn - A function that computes the derived value.
 * @param equal - An optional function that is used to see if the memo should trigger an update
 * @returns {BlockMemo<T>} A block memo object.
 *
 * @example
 * const xSignal = createBlockSignal(0);
 * const ySignal = createBlockSignal(0);
 *
 * // Without memo (not referentially stable)
 * const unstableArray = () => [xSignal(), ySignal()];
 *
 * // With block memo (referentially stable)
 * const stableArray = createBlockMemo(() => [xSignal(), ySignal()]);
 *
 * function PointDisplay() {
 *   return (
 *     <>
 *       <div>Current Point: ({xSignal()}, {ySignal()})</div>
 *       <ChildComponent point={stableArray()} />
 *       <button onClick={() => xSignal.set(x => x + 1)}>Increment X</button>
 *       <button onClick={() => ySignal.set(y => y + 1)}>Increment Y</button>
 *     </>
 *   );
 * }
 *
 * function ChildComponent(props: { point: number[] }) {
 *   // This effect will run only when the array reference changes
 *   createEffect(() => {
 *     console.log("Point updated:", props.point);
 *   });
 *
 *   return <div>Child sees: ({props.point[0]}, {props.point[1]})</div>;
 * }
 */
export function createBlockMemo<T>(
  fn: (...args: any[]) => T,
  equal?: (prev: T | undefined, next: T) => boolean
): BlockMemo<T | undefined> {
  const value = createBlockSignal<T | undefined>(undefined, {
    equals: equal as any,
    internal: true,
  });
  const isInitialized = createBlockSignal(false, {
    internal: true,
  });

  createBlockEffect(() => {
    if (!isInBlock()) return;

    value.set(fn() as any);
    isInitialized.set(true);
  });

  const memoFn = () => {
    const get = value.get;
    if (!isInitialized()) {
      value.set(fn() as any);
      isInitialized.set(true);
    }
    return get();
  };

  return memoFn as BlockMemo<T>;
}

type BlockState<Name extends BlockName = BlockName> = {
  entities: Map<symbol, [any, any]>;
  memos: Map<symbol, () => any>;
  id: string;
  name: Name;
  nested?: NestedState<Name>;
  owner: Owner | null;
};
const BlockContext = createContext<BlockState | undefined>(undefined);

type Creator<T extends any[], R extends [any, any]> = (...args: T) => R;

/**
 * Returns the block data signal cast to Accessor<T | undefined>.
 * @template T - The expected type of the block data
 * @returns The block data signal as Accessor<T | undefined>
 */
export const blockDataSignalAs = <T extends Record<string, any>>(
  key: BlockName
): Accessor<T | undefined> & {
  get: Accessor<T | undefined>;
} => {
  const accessor = () => {
    // this is to prevent a non-related block's effects from running on a mismatching source
    const data = blockDataSignal() as T | undefined;

    // make an exception for start block with chat data
    if (data?.__block === 'start' && key === 'chat') return data;

    return data != null && '__block' in data && data.__block === key
      ? data
      : undefined;
  };

  return Object.assign(accessor, {
    get get() {
      return inBlock(accessor);
    },
  });
};

/**
 * Binds block signal/store getters to a function's first arguments.
 *
 * @param fn Function to bind getters to
 * @param args Block signals or stores
 * @returns New function with bound getters
 */
export function withBlock<A extends any[], B extends any[], R>(
  fn: (...args: [...A, ...B]) => R,
  ...args: A
): (...args: B) => R {
  // @ts-ignore (too strict)
  return fn.bind(this, ...args.map((arg) => arg.get));
}

function isInBlockFn(x: any): x is { block: BlockState | undefined } {
  return x != null && 'block' in x && 'block' != null;
}

export function isInBlock() {
  return useContext(BlockContext) != null;
}

/** You probably shouldn't use this, you probably want createCallback */
export function inBlock<T extends (...args: any[]) => any>(
  this: any,
  fn: T
): T {
  const block = useContext(BlockContext);
  return fn.bind(
    isInBlockFn(this)
      ? this
      : this != null
        ? Object.assign(this, {
            block,
            owner: this?.owner ?? getOwner(),
          })
        : {
            block,
            owner: getOwner(),
          }
  ) as any;
}
