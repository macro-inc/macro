import type {
  ICompatHoldFailure,
  ICompatHoldReleaseReply,
  ICompatHoldReleaseRequest,
  ICompatPublicationHold,
} from '@macro-inc/collaboration/session/compatibility.generated';

export interface PublicationHoldPorts {
  /** Actual synchronous executor/native call; an unknown result must never be replayed. */
  readonly runRelease: (
    request: ICompatHoldReleaseRequest
  ) => ICompatHoldReleaseReply;
  readonly clocks: {
    readonly now: () => number;
    readonly wall: () => number;
  };
  readonly consumeFlags: (flags: number) => void;
  /** Retain decoded receipts and resume only their unfinished acknowledgements on failure. */
  readonly drainPublicationsAndAcknowledge: () => void;
  readonly decodeFailure: (failure: ICompatHoldFailure) => unknown;
}

export type PublicationHoldPhase =
  | 'idle'
  | 'acknowledging'
  | 'releasing'
  | 'consuming-flags'
  | 'draining'
  | 'drain-in-progress'
  | 'blocked';

export interface PublicationHoldDiagnostic {
  readonly phase: PublicationHoldPhase;
  readonly disposition: ICompatPublicationHold | undefined;
  readonly ticketId: bigint | undefined;
  readonly reply: ICompatHoldReleaseReply | undefined;
  readonly cause: unknown;
}

/** Orders real local acknowledgement before remote release; it owns no editor or executor. */
export class PublicationHoldDriver {
  private phase: PublicationHoldPhase = 'idle';
  private disposition: ICompatPublicationHold | undefined;
  private ticketId: bigint | undefined;
  private reply: ICompatHoldReleaseReply | undefined;
  private cause: unknown;

  constructor(private readonly ports: PublicationHoldPorts) {}

  get diagnostic(): PublicationHoldDiagnostic {
    return {
      phase: this.phase,
      disposition: this.disposition,
      ticketId: this.ticketId,
      reply: this.reply,
      cause: this.cause,
    };
  }

  acknowledge(
    disposition: ICompatPublicationHold,
    acknowledgeLocal: () => void
  ): void {
    if (this.phase !== 'idle')
      throw new Error(
        'Publication acknowledgement is already pending or blocked'
      );
    // Retain the received disposition even if its validation/local acknowledgement fails.
    this.disposition = disposition;
    this.phase = 'acknowledging';
    let ticketId: bigint | undefined;
    try {
      const authority = disposition.data;
      switch (authority.discriminator) {
        case 1:
          break;
        case 2:
          ticketId = authority.value.ticketId;
          if (ticketId <= 0n || ticketId > 0xffff_ffff_ffff_ffffn)
            throw new Error('Publication hold has no valid issued ticket');
          break;
        default:
          throw new Error('Unknown publication hold disposition');
      }
      acknowledgeLocal();
    } catch (error) {
      this.block(error);
      throw error;
    }
    if (ticketId === undefined) {
      this.complete();
      return;
    }
    // Authority becomes release-ready only after the actual local receipt is acknowledged.
    this.ticketId = ticketId;
    this.phase = 'releasing';
    try {
      const now = this.ports.clocks.now();
      const wall = this.ports.clocks.wall();
      if (!Number.isFinite(now) || now < 0 || !Number.isFinite(wall))
        throw new Error(
          'Publication release requires fresh finite host clocks'
        );
      this.reply = this.ports.runRelease({ ticketId, now, wall });
      this.validateReply(this.reply);
      this.phase = 'consuming-flags';
      this.ports.consumeFlags(this.reply.flags);
    } catch (error) {
      // A partial flag application or unknown native result cannot safely be repeated.
      this.block(error);
      throw error;
    }
    this.phase = 'draining';
    this.finishDrain();
  }

  /** Resume only unfinished receipt draining after a known reply and consumed flags. */
  resume(): void {
    if (this.phase !== 'draining')
      throw new Error(
        'Only an acknowledged release publication drain can resume'
      );
    this.finishDrain();
  }

  private finishDrain(): void {
    const reply = this.reply;
    if (this.phase !== 'draining' || reply === undefined)
      throw new Error('Publication release has no acknowledged reply');
    this.phase = 'drain-in-progress';
    try {
      this.ports.drainPublicationsAndAcknowledge();
    } catch (error) {
      this.phase = 'draining';
      this.cause = error;
      throw error;
    }
    const outcome = reply.outcome.data;
    if (outcome.discriminator === 3) {
      this.phase = 'blocked';
      try {
        this.cause = this.ports.decodeFailure(outcome.value.failure);
      } catch (error) {
        this.cause = error;
        throw error;
      }
      throw this.cause;
    }
    this.complete();
  }

  private validateReply(reply: ICompatHoldReleaseReply): void {
    if (
      !Number.isInteger(reply.flags) ||
      reply.flags < 0 ||
      reply.flags > 0xffff_ffff
    )
      throw new Error('Publication release has invalid native flags');
    switch (reply.outcome.data.discriminator) {
      case 1:
      case 2:
      case 3:
        return;
      default:
        throw new Error('Unknown publication release outcome');
    }
  }

  private block(cause: unknown): void {
    this.phase = 'blocked';
    this.cause = cause;
  }

  private complete(): void {
    this.phase = 'idle';
    this.disposition = undefined;
    this.ticketId = undefined;
    this.reply = undefined;
    this.cause = undefined;
  }
}
