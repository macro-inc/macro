import type { ChatStream } from '@service-cognition/generated/schemas';
import { describe, expect, it } from 'vitest';
import { asChatMessage } from './message';

function textItem(text: string): ChatStream {
  return {
    type: 'chat_message_response',
    chat_id: 'chat',
    message_id: 'message',
    stream_id: 'stream',
    content: { type: 'text', text },
  };
}

function toolCallItem(i: number): ChatStream {
  return {
    type: 'chat_message_response',
    chat_id: 'chat',
    message_id: 'message',
    stream_id: 'stream',
    content: { type: 'toolCall', name: `tool${i}`, json: {}, id: `call${i}` },
  };
}

function toolResponseItem(i: number): ChatStream {
  return {
    type: 'chat_message_response',
    chat_id: 'chat',
    message_id: 'message',
    stream_id: 'stream',
    content: {
      type: 'toolCallResponseJson',
      name: `tool${i}`,
      json: { ok: true },
      id: `call${i}`,
    },
  };
}

/* Each tool call/response pair is its own unmergeable part, so a message with
   `count` tool calls ends up with roughly 2*count distinct top-level parts —
   exactly the shape a "did a bunch of tool calls" turn produces. */
function buildToolCallHeavyItems(count: number): ChatStream[] {
  const items: ChatStream[] = [];
  for (let i = 0; i < count; i++) {
    items.push(toolCallItem(i));
    items.push(toolResponseItem(i));
  }
  items.push(textItem('done'));
  return items;
}

/* Mirrors how ChatMessages.tsx's generatingMessage() actually calls this:
   once per stream update, on the whole array received so far. */
function simulateTicks(items: ChatStream[]): number {
  const start = performance.now();
  for (let i = 1; i <= items.length; i++) {
    asChatMessage(items.slice(0, i));
  }
  return performance.now() - start;
}

describe('asChatMessage', () => {
  it('merges consecutive text parts, keeps tool calls as separate parts', () => {
    const items = [
      textItem('Hello '),
      textItem('world'),
      toolCallItem(1),
      toolResponseItem(1),
      textItem('done'),
    ];
    const message = asChatMessage(items);
    expect(message?.content).toEqual([
      { type: 'text', text: 'Hello world' },
      { type: 'toolCall', name: 'tool1', json: {}, id: 'call1' },
      {
        type: 'toolCallResponseJson',
        name: 'tool1',
        json: { ok: true },
        id: 'call1',
      },
      { type: 'text', text: 'done' },
    ]);
  });

  it('does not blow up cubically over a stream of many tool calls', () => {
    /* Every item in the reduce used to spread-copy the whole accumulated
       parts array so far (`[...acc.slice(0, -1), x]` / `[...acc, x]`),
       regardless of whether it merges into the last part. Tool calls never
       merge, so each one grows the accumulator — one call already costs
       O(n^2) for a tool-call-heavy message. Since the caller
       (ChatMessages.tsx's generatingMessage) re-invokes asChatMessage on the
       whole stream once per incoming chunk, that O(n^2) per call becomes
       O(n^3) over the life of a "did a bunch of tool calls" turn — this is
       what made those responses stay slow even after the bufferedStream fix. */
    const smallTime = simulateTicks(buildToolCallHeavyItems(300));
    const largeTime = simulateTicks(buildToolCallHeavyItems(600));

    /* Doubling input: linear is ~2x, quadratic ~4x, cubic (the bug) ~8x.
       5x sits clearly between quadratic and cubic. */
    expect(largeTime).toBeLessThan(smallTime * 5 + 20);
  });
});
