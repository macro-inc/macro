import type { HostCommitPacket } from '../../../lexical-conformance/diff/host-packet.generated';

export type CommitPacket = HostCommitPacket;

/** Development-only model boundary. Scheduling and JS object handles live above it. */
export interface ShimBackend {
  beginUpdate(tags: readonly string[], discrete: boolean): void;
  call(name: string, args: readonly unknown[], receiver?: unknown): unknown;
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
