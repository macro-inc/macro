// fullStream parts                  ToolInputRouter                StreamingToolInput
// ─────────────────                 ───────────────                ──────────────────
//
// tool-input-start                  toolName matches?
//   id="call-1"                     yes → create buffer
//   toolName="dispatch"             buffers.set("call-1", new StreamingToolInput(...))
//
// tool-input-delta                  buffers.get("call-1")          push(delta)
//   id="call-1"                     → found, forward                 text += delta
//   delta='{"edits":[{"editing…'                                     drain(false)
//                                                                     arr=[{half}]
//                                                                     ready = 0, emit nothing
//
// tool-input-delta                  buffers.get("call-1")          push(delta)
//   id="call-1"                     → found, forward                 text += delta
//   delta='…bold"},{"editing…'                                       drain(false)
//                                                                     arr=[{done},{half}]
//                                                                     ready = 1
//                                                                     → onElement(edit0) 🚀
//
// tool-input-delta                  buffers.get("call-1")          push(delta)
//   id="call-1"                     → found, forward                 drain(false)
//   delta='…list"}]}'                                                arr=[{done},{done}]
//                                                                     ready = 1, nothing new
//
// tool-input-end                    buffers.get("call-1")          end()
//   id="call-1"                     → found, delete, forward          drain(true)
//                                                                     ready = 2
//                                                                     → onElement(edit1) 🚀

import { parsePartialJson, type TextStreamPart, type ToolSet } from 'ai';

export type StreamingToolInputOptions<T> = {
  /** Array field whose elements are emitted as they finalize. Element `i` is
   *  final once element `i+1` starts or the stream ends. */
  elementsField: string;
  onElement: (element: T, index: number) => void;
};

/**
 * Accumulates one streaming tool-call's JSON input and emits the watched
 * array's elements the moment they are final.
 */
export class StreamingToolInput<T> {
  private text = '';
  private emitted = 0;

  constructor(private readonly opts: StreamingToolInputOptions<T>) {}

  async push(delta: string): Promise<void> {
    this.text += delta;
    await this.drain(false);
  }

  /** The input closed — the trailing element is now safe to emit. */
  async end(): Promise<void> {
    await this.drain(true);
  }

  private async drain(final: boolean): Promise<void> {
    const { value, state } = await parsePartialJson(this.text);
    if (state === 'failed-parse' || state === 'undefined-input') return;
    const args = value as Record<string, unknown> | undefined;
    if (typeof args !== 'object' || args === null) return;
    const arr = args[this.opts.elementsField];
    if (!Array.isArray(arr)) return;
    // The partial parser repairs the trailing element into existence even when
    // it is half-written — only safe to emit once a successor appears or the
    // stream ends.
    const ready = final ? arr.length : arr.length - 1;
    for (; this.emitted < ready; this.emitted++) {
      this.opts.onElement(arr[this.emitted] as T, this.emitted);
    }
  }
}

/**
 * Routes `fullStream` tool-input parts for one named tool into a per-call
 * `StreamingToolInput`. Ignores every other tool and part kind, so a stream
 * loop can hand it all parts unconditionally.
 */
export class ToolInputRouter<T> {
  private readonly buffers = new Map<string, StreamingToolInput<T>>();

  constructor(
    private readonly toolName: string,
    private readonly makeInput: (toolCallId: string) => StreamingToolInput<T>
  ) {}

  async handle(part: TextStreamPart<ToolSet>): Promise<void> {
    if (part.type === 'tool-input-start') {
      if (part.toolName === this.toolName)
        this.buffers.set(part.id, this.makeInput(part.id));
    } else if (part.type === 'tool-input-delta') {
      // Deltas carry only the call id; unknown ids belong to other tools.
      await this.buffers.get(part.id)?.push(part.delta);
    } else if (part.type === 'tool-input-end') {
      const buffer = this.buffers.get(part.id);
      if (!buffer) return;
      this.buffers.delete(part.id);
      await buffer.end();
    }
  }
}
