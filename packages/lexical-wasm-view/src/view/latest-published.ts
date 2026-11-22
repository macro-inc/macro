import type { ExecutorFailure } from '@macro-inc/collaboration/session/executor';
import { Telemetry } from '@macro-inc/observability';
import type { EditorView } from './editor-view';

export type LatestPublishedUnavailable =
  | { readonly kind: 'native-error' }
  | {
      readonly kind: 'entry' | 'apply' | 'cleanup' | 'observer';
      readonly failure: ExecutorFailure;
    }
  | { readonly kind: 'observer-reentry' | 'publication-changed' };

/** Current published presentation only, never a commit or ownership receipt. */
export interface LatestPublishedObserver {
  published(view: EditorView): void;
  unavailable(reason: LatestPublishedUnavailable): void;
  /** Pure terminal cleanup; do not enter native receivers. */
  retired(): void;
}

interface Registration {
  readonly observer: LatestPublishedObserver;
  active: boolean;
  cleaned: boolean;
}

/** A construction-time list, observed only at the actual outer drain boundary. */
export class LatestPublishedObservers {
  private readonly registrations: Registration[];
  private terminal = false;
  private notifying = false;
  private current: Registration | undefined;
  private pending = false;

  constructor(
    observers: readonly LatestPublishedObserver[],
    private readonly live: () => EditorView | undefined
  ) {
    this.registrations = observers.map((observer) => ({
      observer,
      active: true,
      cleaned: false,
    }));
  }

  published(): void {
    if (this.terminal) return;
    if (this.notifying) {
      if (this.current?.active)
        this.unavailableOne(this.current, { kind: 'observer-reentry' });
      this.pending = true;
      return;
    }
    this.notifying = true;
    try {
      do {
        this.pending = false;
        for (const registration of this.registrations) {
          if (!registration.active) continue;
          const view = this.live();
          if (!view) return;
          if (!view.isMounted) {
            this.retired();
            return;
          }
          const generation = view.mirror.keyGeneration;
          if (generation === null) return;
          const revision = view.revision;
          this.current = registration;
          try {
            registration.observer.published(view);
          } catch (error) {
            this.unavailableOne(registration, {
              kind: 'observer',
              failure: { error },
            });
            this.report(error);
          } finally {
            this.current = undefined;
          }
          if (this.terminal) return;
          if (this.pending) break;
          if (
            this.live() !== view ||
            !view.isMounted ||
            view.mirror.keyGeneration !== generation ||
            view.revision !== revision
          ) {
            this.unavailable({ kind: 'publication-changed' });
            return;
          }
        }
      } while (this.pending && !this.terminal);
    } finally {
      this.current = undefined;
      this.notifying = false;
    }
  }

  unavailable(reason: LatestPublishedUnavailable): void {
    if (this.terminal) return;
    this.terminal = true;
    for (const registration of this.registrations)
      this.unavailableOne(registration, reason);
  }

  retired(): void {
    if (this.terminal) return;
    this.terminal = true;
    for (const registration of this.registrations) {
      registration.active = false;
      this.cleanupOne(registration);
    }
  }

  private unavailableOne(
    registration: Registration,
    reason: LatestPublishedUnavailable
  ): void {
    if (!registration.active) return;
    registration.active = false;
    try {
      registration.observer.unavailable(reason);
    } catch (error) {
      this.report(error);
    } finally {
      this.cleanupOne(registration);
    }
  }

  private cleanupOne(registration: Registration): void {
    if (registration.cleaned) return;
    registration.cleaned = true;
    try {
      registration.observer.retired();
    } catch (error) {
      this.report(error);
    }
  }

  private report(error: unknown): void {
    try {
      Telemetry.error(error, { surface: 'editor.latest-published.secondary' });
    } catch {
      // Optional observation cannot replace an input or cleanup result.
    }
  }
}
