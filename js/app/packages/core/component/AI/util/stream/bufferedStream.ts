import type {
  AssistantMessagePart,
  ChatStream,
} from '@service-cognition/generated/schemas';
import {
  type ChatMessageStream,
  type ChatStreamController,
  createStreamController,
} from '@service-connection/stream';
import { createEffect, on } from 'solid-js';
import { match, P } from 'ts-pattern';

/* Target latency between character */
const TARGET_LATENCY_MS = 6;
/*
  Catchup is triggered if the buffered  stream is significantly trailing behind
  the source stream. This can happen on reconnects
*/
const CATCHUP_LATENCY_CHUNKS = 2;

/*
 Communicates what part of source stream has been consumed
 used for hand-off between smoothConsumer and catchUpConsumer
*/
interface Consumed {
  /* outer index in stream of AssistantMessagePart */
  anchor: number;
  /*
   smoothConsumer splits TextPart into many TextPart
   this is the index within a textPart
  */
  textPartOffset?: number;
  /* index the stream at the consumed marker */
  index(stream: BufferedStream): ChatStream | undefined;
  /* increment the consumed marker */
  increment(stream: BufferedStream): void;
  /* emit everything possible */
  takeRemaining(stream: BufferedStream): ChatStream[];
}

interface ConsumerHandle {
  cleanup(): Consumed;
}

type BufferedStream = {
  source: ChatMessageStream;
  controller: ChatStreamController;
  dispatch: (event: BufferEvent) => void;
};

type BufferState =
  | { type: 'catching-up'; stream: BufferedStream; consumer: ConsumerHandle }
  | { type: 'consuming'; stream: BufferedStream; consumer: ConsumerHandle }
  | { type: 'waiting'; stream: BufferedStream; consumed?: Consumed }
  | { type: 'done'; stream: BufferedStream };

type BufferEvent =
  | { event: 'source-data'; data: ChatStream[] }
  | { event: 'fall-behind-detected' }
  | { event: 'consumer-done' }
  | { event: 'catch-up-done' }
  | { event: 'source-done' };

/**
 * True when the source has run far enough ahead of the consumed marker to
 * justify a catch-up jump instead of continuing to drip one unit at a time.
 * Distance is measured in whole source parts (not characters), so a single huge
 * text part never trips this on its own. Typically happens after a reconnect,
 * when a backlog of parts lands at once.
 */
function isBehind(stream: BufferedStream, consumed?: Consumed): boolean {
  const data = stream.source.data();
  if (!consumed) {
    return data.length > CATCHUP_LATENCY_CHUNKS;
  } else {
    return data.length - consumed.anchor > CATCHUP_LATENCY_CHUNKS;
  }
}

/**
 * Returns the single ChatStream unit sitting at the current consumed marker, or
 * `undefined` when nothing remains to emit there. A text part is narrowed to the
 * one code point at `textPartOffset` (this is how the smooth consumer emits a
 * character at a time); any other part type is returned whole at `anchor`. Read
 * only — it never moves the marker (see `increment`). Backs `Consumed.index`.
 */
function indexConsumed(
  this: Consumed,
  stream: BufferedStream
): ChatStream | undefined {
  if (this.anchor >= stream.source.data().length) return;
  const data = stream.source.data()[this.anchor];
  if (data.type !== 'chat_message_response') return data;

  return (
    match<AssistantMessagePart, ChatStream | undefined>(data.content)
      .with({ type: 'text' }, (textPart) => {
        /* index by code point, not UTF-16 unit, so surrogate pairs stay intact */
        const chars = Array.from(textPart.text);
        if (chars.length === 0) return;
        /* End of stream */
        if (this.textPartOffset && this.textPartOffset >= chars.length) {
          return;
        } else if (this.textPartOffset) {
          /* have an index into the text part -> use it*/
          return {
            ...data,
            content: {
              ...data.content,
              text: chars[this.textPartOffset],
            },
          };
        } else {
          /* Don't have an index assume 0 */
          return {
            ...data,
            content: {
              ...data.content,
              text: chars[0],
            },
          };
        }
      })
      /* not a text part -> use anchor */
      .otherwise((part) => ({
        ...data,
        content: part,
      }))
  );
}

/**
 * Advances the consumed marker by exactly one emittable unit, mirroring what
 * `index` just returned: step `textPartOffset` to the next code point inside a
 * text part, or move `anchor` to the next source part once the current one is
 * exhausted. Must stay in lock-step with `index` (both count code points, not
 * UTF-16 units) or content would be skipped or duplicated. Backs
 * `Consumed.increment`.
 */
function incrementConsumed(this: Consumed, stream: BufferedStream) {
  const data = stream.source.data();
  const current = data[this.anchor];
  if (!current) return;
  if (current.type !== 'chat_message_response') {
    this.anchor += 1;
    this.textPartOffset = undefined;
    return;
  }
  match([current.content, this.textPartOffset])
    .with([{ type: 'text' }, undefined], ([part, _]) => {
      /* count by code point to match indexConsumed */
      if (Array.from(part.text).length > 1) {
        this.textPartOffset = 1;
      } else {
        this.textPartOffset = undefined;
        this.anchor += 1;
      }
    })
    .with([{ type: 'text' }, P.number], ([part, i]) => {
      /* count by code point to match indexConsumed */
      if (i + 1 < Array.from(part.text).length) {
        this.textPartOffset = i + 1;
      } else {
        this.textPartOffset = undefined;
        this.anchor += 1;
      }
    })
    .otherwise(() => {
      this.textPartOffset = undefined;
      this.anchor += 1;
    });
}

/**
 * Emits everything from the consumed marker to the end of the currently
 * available source data in one shot and advances the marker past all of it.
 * Powers catch-up jumps and the final flush: a partially-consumed text part is
 * emitted from `textPartOffset` onward, followed by every later part whole.
 * Preserves source order and content exactly. Backs `Consumed.takeRemaining`.
 */
function takeRemainingConsumed(
  this: Consumed,
  stream: BufferedStream
): ChatStream[] {
  const data = stream.source.data();
  return match<[ChatStream | undefined, number | undefined], ChatStream[]>([
    data[this.anchor],
    this.textPartOffset,
  ])
    .with([undefined, P._], () => [])
    .with(
      [{ type: 'chat_message_response', content: { type: 'text' } }, P.number],
      ([textPart, i]) => {
        const firstText = Array.from(textPart.content.text).slice(i).join('');
        const firstPart = {
          ...textPart,
          content: { ...textPart.content, text: firstText },
        };
        const remaining = data.slice(this.anchor + 1);
        this.textPartOffset = undefined;
        this.anchor = data.length;
        return [firstPart, ...remaining];
      }
    )
    .otherwise(() => {
      const remaining = data.slice(this.anchor);
      this.textPartOffset = undefined;
      this.anchor = data.length;
      return remaining;
    });
}

/**
 * Builds a fresh consumed marker at the start of the source (anchor 0, no text
 * offset) wired to the index/increment/takeRemaining behaviour.
 */
function createConsumed(): Consumed {
  return {
    anchor: 0,
    index: indexConsumed,
    increment: incrementConsumed,
    takeRemaining: takeRemainingConsumed,
  };
}

/**
 * Drives the smooth playback loop: emits one unit (a single character for text)
 * every TARGET_LATENCY_MS via setTimeout, resuming from `prev` when handed an
 * existing marker. Dispatches `fall-behind-detected` when the source has raced
 * too far ahead (so the machine hands off to a catch-up consumer) or
 * `consumer-done` once it drains everything currently available. `cleanup`
 * cancels the pending tick and returns the marker so the next consumer resumes
 * exactly where this one stopped.
 */
function createSmoothConsumer(
  stream: BufferedStream,
  prev?: Consumed
): ConsumerHandle {
  let timeout: ReturnType<typeof setTimeout> | undefined;

  const consumed = prev ? prev : createConsumed();

  /* Emit one unit then schedule the next tick — unless we've fallen behind or run dry. */
  function takeOne() {
    let part: ChatStream | undefined;
    if (isBehind(stream, consumed)) {
      stream.dispatch({ event: 'fall-behind-detected' });
      return;
    }
    part = consumed.index(stream);
    consumed.increment(stream);

    if (!part) {
      stream.dispatch({ event: 'consumer-done' });
    } else {
      stream.controller.setData((p) => [...p, part]);
      timeout = setTimeout(takeOne, TARGET_LATENCY_MS);
    }
  }

  takeOne();

  /* Stop the playback loop and hand back the marker for the next consumer. */
  function cleanup() {
    if (timeout) clearTimeout(timeout);
    return consumed;
  }
  return { cleanup };
}

/**
 * Closes a large gap in one go: flushes all currently-buffered source data to
 * the output without per-character pacing, then dispatches `catch-up-done`. Used
 * after the smooth consumer falls behind (e.g. a reconnect backlog) so the
 * viewer snaps to the live position instead of crawling. `cleanup` returns the
 * now fully-advanced marker for the consumer that takes over.
 */
function createCatchUpConsumer(
  stream: BufferedStream,
  prev?: Consumed
): ConsumerHandle {
  const consumed = prev ? prev : createConsumed();
  const rest = consumed.takeRemaining(stream);
  stream.controller.setData((p) => [...p, ...rest]);
  stream.dispatch({ event: 'catch-up-done' });

  /* Nothing to tear down; just surface the advanced marker. */
  function cleanup() {
    return consumed;
  }

  return { cleanup };
}

/**
 * Single step of the buffering state machine: maps (current state, event) to the
 * next state and performs that edge's side effects — spawning or cleaning up
 * consumers, flushing buffered data, and signalling done on the output
 * controller. The flow is waiting (idle, nothing to emit) -> consuming (dripping
 * smoothly) -> catching-up (jumping ahead after falling behind) -> done, with
 * consuming and waiting cycling as data arrives. Each match arm is annotated
 * with the edge it handles; unlisted (state, event) pairs are intentional no-ops.
 */
function transition(
  currentState: BufferState,
  event: BufferEvent
): BufferState {
  return (
    match<[BufferState, BufferEvent], BufferState>([currentState, event])
      /* ignore events */
      /* ignore any event in done state*/
      .with([{ type: 'done' }, P._], ([state, _]) => state)
      /* ignore any event while catching up except catch-up-done */
      .with(
        [{ type: 'catching-up' }, P.not({ event: 'catch-up-done' })],
        ([state, _]) => state
      )
      /* ignore source finished if consuming*/
      .with(
        [{ type: 'consuming' }, { event: 'source-done' }],
        ([state, _]) => state
      )
      /* waiting -> consuming */
      .with([{ type: 'waiting' }, { event: 'source-data' }], ([state, _]) => {
        const consumer = createSmoothConsumer(state.stream, state.consumed);
        return { type: 'consuming', stream: state.stream, consumer };
      })
      .narrow()
      /* waiting -> done */
      .with([{ type: 'waiting' }, { event: 'source-done' }], ([state]) => {
        /* flush anything buffered past the consumed marker before completing */
        const consumed = state.consumed ?? createConsumed();
        const rest = consumed.takeRemaining(state.stream);
        state.stream.controller.setData((p) => [...p, ...rest]);
        state.stream.controller.setDone();
        return { type: 'done', stream: state.stream };
      })
      /* ignore waiting [consumer-done, catch-up-done, fall-behind-detected] */
      .with([{ type: 'waiting' }, P._], ([state, _e]) => state)
      /* catching-up -> consume | done */
      .with(
        [{ type: 'catching-up' }, { event: 'catch-up-done' }],
        ([state, _]) => {
          if (state.stream.source.isDone()) {
            state.consumer.cleanup();
            state.stream.controller.setDone();
            return { type: 'done', stream: state.stream };
          } else {
            const consumed = state.consumer.cleanup();
            const consumer = createSmoothConsumer(state.stream, consumed);
            return { type: 'consuming', stream: state.stream, consumer };
          }
        }
      )
      /* consuming -> catching-up */
      .with(
        [{ type: 'consuming' }, { event: 'fall-behind-detected' }],
        ([state, _e]) => {
          const consumed = state.consumer.cleanup();
          const consumer = createCatchUpConsumer(state.stream, consumed);
          return { type: 'catching-up', stream: state.stream, consumer };
        }
      )
      /* consuming -> waiting | done */
      .with(
        [{ type: 'consuming' }, { event: 'consumer-done' }],
        ([state, _e]) => {
          if (state.stream.source.isDone()) {
            state.consumer.cleanup();
            state.stream.controller.setDone();
            return { type: 'done', stream: state.stream };
          } else {
            const consumed = state.consumer.cleanup();
            return { type: 'waiting', stream: state.stream, consumed };
          }
        }
      )
      .narrow()
      .with([{ type: 'consuming' }, P._], ([state, _e]) => state)
      .exhaustive()
  );
}

/**
 * FIFO event bus with a synchronous, reentrancy-guarded drain. A dispatch made
 * while a drain is already running (e.g. a consumer emitting from inside
 * `transition`) is enqueued and processed only after the current handler
 * returns, so nested events always observe the already-updated state. Unlike a
 * single Solid signal used as an event slot, events are never coalesced or lost.
 */
function createEventQueue<E>(handler: (event: E) => void) {
  const queue: E[] = [];
  let draining = false;

  return function dispatch(event: E) {
    queue.push(event);
    if (draining) return;
    draining = true;
    try {
      while (queue.length > 0) {
        handler(queue.shift()!);
      }
    } finally {
      draining = false;
    }
  };
}

/**
 * Wraps a raw chat stream in a smoothing buffer. Rather than dumping tokens as
 * they arrive, it replays them character-by-character at a steady cadence for a
 * typewriter feel, while still snapping forward to the live position whenever it
 * falls too far behind (e.g. on reconnect). The returned stream emits the same
 * content in the same order as the source — only the chunking and timing differ.
 *
 * Solid is used purely to observe the source (`data`/`isDone`); all sequencing
 * runs through the FIFO event queue feeding the `transition` state machine.
 */
export function bufferedStream(source: ChatMessageStream): ChatMessageStream {
  const controller = createStreamController<'chat'>(source.id);

  let state: BufferState;
  const dispatch = createEventQueue<BufferEvent>((event) => {
    state = transition(state, event);
  });

  const stream: BufferedStream = { source, controller, dispatch };
  state = { type: 'waiting', stream };

  /* Solid only bridges the reactive inputs into the queue */

  /* source stream new data */
  createEffect(
    on(source.data, (data) => {
      stream.dispatch({ event: 'source-data', data });
    })
  );

  /* source stream finished */
  createEffect(
    on(source.isDone, (isDone) => {
      if (!isDone) return;
      stream.dispatch({ event: 'source-done' });
    })
  );

  return controller.stream;
}
