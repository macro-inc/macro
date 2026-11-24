/** A clock that stands still while it is not running. */
export class VisibleTime {
  private totalMs = 0;
  private runningSince: number | undefined;

  constructor(private readonly now: () => number) {}

  get elapsedMs(): number {
    if (this.runningSince === undefined) return this.totalMs;
    return this.totalMs + this.now() - this.runningSince;
  }

  setRunning(running: boolean): void {
    if (running === (this.runningSince !== undefined)) return;
    this.totalMs = this.elapsedMs;
    this.runningSince = running ? this.now() : undefined;
  }
}
