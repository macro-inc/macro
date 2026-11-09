import type {
  ReviewedState,
  ReviewedSuggestion,
  SuggestOutcome,
  Surface,
} from '../../../generated/scheduled-action/types.gen';
import { unwrap } from '../../utils';
import type { MacroClient } from '../../utils/client';

/**
 * A routine suggestion AI made for the user, as a routines session reviews
 * it. List-sourced only, from `macro.routines.review()`, so this wraps the
 * record the caller already has.
 */
export class RoutineSuggestion {
  private constructor(
    private readonly client: MacroClient,
    private readonly record: ReviewedSuggestion,
  ) {}

  /** Wrap a reviewed suggestion already in hand. */
  static from(
    client: MacroClient,
    record: ReviewedSuggestion,
  ): RoutineSuggestion {
    return new RoutineSuggestion(client, record);
  }

  /** The suggestion's id. */
  get id(): string {
    return this.record.id;
  }

  /** `open`; `dismissed` by the user (never suggest it again); `retired` by a session (it may come back); or `saved` as a routine. */
  get state(): ReviewedState {
    return this.record.state;
  }

  /** The reason the user reads. */
  get reason(): string {
    return this.record.reason;
  }

  /** The sidebars it shows in. */
  get surfaces(): Surface[] {
    return this.record.surfaces;
  }

  /** The chance, from 0 to 1, the user keeps it on. */
  get keepProbability(): number {
    return this.record.keepProbability;
  }

  /** `catalog` with its `key` and `knobs`, or `routine` with the drafted `routine`. */
  get pick(): ReviewedSuggestion {
    return this.record;
  }

  /** When it was suggested, as RFC 3339. */
  get createdAt(): string {
    return this.record.createdAt;
  }

  /** When it was dismissed or retired, as RFC 3339. */
  get closedAt(): string | undefined {
    return this.record.closedAt ?? undefined;
  }

  /**
   * Retire this open suggestion because it no longer fits the user's work,
   * with a one-line `reason`. Only a routines generation session may. A
   * retired catalog routine may be suggested again later.
   */
  async retire(reason: string): Promise<SuggestOutcome> {
    return unwrap(
      await this.client.scheduledAction.retireRoutineSuggestion({
        path: { id: this.id },
        body: { reason },
      }),
    );
  }
}
