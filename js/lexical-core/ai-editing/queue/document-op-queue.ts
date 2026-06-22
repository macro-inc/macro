import type { DocumentOp } from '../editor/ops';
import type { DocReader } from '../doc/interfaces';
import { animate } from './animators';
import type { RandomSource } from './random-source';
import { DEFAULT_RANGES, type DocumentOpAction, type RandomRanges } from './types';

export type DocumentOpQueueParams = {
  speed: number;
  ranges: RandomRanges;
};

export const DEFAULT_QUEUE_PARAMS: DocumentOpQueueParams = {
  speed: 800,
  ranges: DEFAULT_RANGES,
};

const msPerChar = (wpm: number) => 60_000 / (wpm * 5);

export type StepArgs = { randomSource: RandomSource; docReader: DocReader };

export class DocumentOpQueue {
  private i = 0;
  private last: DocumentOp | null = null;
  private readonly msPerChar: number;
  private readonly ranges: RandomRanges;

  private constructor(
    private readonly ops: DocumentOp[],
    params: DocumentOpQueueParams
  ) {
    this.msPerChar = msPerChar(params.speed);
    this.ranges = params.ranges;
  }

  static from(ops: DocumentOp[], params: DocumentOpQueueParams): DocumentOpQueue {
    return new DocumentOpQueue(ops, params);
  }

  /** Remaining ops not yet stepped. */
  public get remaining(): number {
    return this.ops.length - this.i;
  }

  public get isDone(): boolean {
    return this.i >= this.ops.length;
  }

  /** The op produced by the most recent `step()` (for summaries/error attribution). */
  public get lastOp(): DocumentOp | null {
    return this.last;
  }

  public step({ randomSource, docReader }: StepArgs): DocumentOpAction {
    if (this.i >= this.ops.length) {
      this.last = null;
      return { done: true, steps: [] };
    }
    const op = this.ops[this.i++]!;
    this.last = op;
    const steps = animate(op, { randomSource, docReader, msPerChar: this.msPerChar, ranges: this.ranges });
    return { done: this.i >= this.ops.length, steps };
  }
}
