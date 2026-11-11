import type {
  HostCommitPacket,
  HostNodeMutation,
} from '../../../lexical-conformance/diff/host-packet.generated';

export type CommitPacket = HostCommitPacket;

export interface UpdateMetadata {
  readonly dirtyLeaves: Set<string>;
  readonly dirtyElements: Map<string, boolean>;
  readonly dirtyType: number;
}

export type NodeLifetime =
  | { readonly kind: 'version' }
  | { readonly kind: 'capture'; readonly owner: object };

export interface NodeHandleCache {
  releaseCaptureHandle(handle: number): void;
}

/** Node/state ownership only; diagnostic native fixtures use the same finalizer. */
export interface NodeHandleBackend {
  ownNodeHandles(cache: NodeHandleCache): void;
  nodeLifetime(handle: number, node: object): NodeLifetime;
  collectVersion(
    version: string,
    unowned: () => boolean,
    released: () => void
  ): void;
}

/** Engine boundary. Scheduling and JS object handles live above it. */
export interface ShimBackend extends NodeHandleBackend {
  readonly initialVersion: number;
  getUpdateMetadata(): UpdateMetadata;
  installForeign(
    type: string,
    dispatch: (message: HostNodeMutation<unknown, unknown>) => unknown
  ): void;
  setForeignMask(type: string, mask: bigint): void;
  beginUpdate(tags: readonly string[], discrete: boolean): void;
  call(name: string, args: readonly unknown[], receiver?: unknown): unknown;
  callNative(
    name: string,
    args: readonly unknown[],
    receiver: unknown
  ): unknown;
  readState(version: string, body: () => unknown): unknown;
  getNodeMap<Node>(
    version: string,
    resolve: (raw: unknown) => Node
  ): Map<string, Node>;
  flush(): void;
  finishNoop(): boolean;
  commit(): CommitPacket;
  discard(): void;
  readField(handle: number, field: string): unknown;
  releaseVersion(version: string): void;
  registerTransform(type: string, dispatch: (node: unknown) => unknown): number;
  registerListener(
    command: object,
    priority: number,
    dispatch: (payload: unknown) => unknown
  ): number;
  dispatchCommand(command: object, payload: unknown): boolean;
  unregister(id: number): void;
  dispose(): void;
}
