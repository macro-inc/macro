import { ownerLock } from './storage';

/** The release callback runs only after the actual Web Lock has left held locks. */
export class SessionLease {
  readonly ready: Promise<void>;
  private releaseLock?: () => void;
  private readonly held: Promise<void>;
  constructor(
    doc: string,
    owner: string,
    locks: Pick<LockManager, 'request'> = navigator.locks
  ) {
    let granted!: () => void;
    let denied!: (error: unknown) => void;
    this.ready = new Promise<void>((resolve, reject) => {
      granted = resolve;
      denied = reject;
    });
    this.held = Promise.resolve(
      locks.request(ownerLock(doc, owner), { mode: 'exclusive' }, async () => {
        await new Promise<void>((release) => {
          this.releaseLock = release;
          granted();
        });
      })
    ).then(
      () => undefined,
      (error) => {
        denied(error);
      }
    );
  }
  async release(): Promise<void> {
    await this.ready;
    this.releaseLock?.();
    await this.held;
  }
}
