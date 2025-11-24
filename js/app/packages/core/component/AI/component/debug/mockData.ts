import { mockMessages } from '@core/component/AI/util/mockMessage';
import type { NetworkDelay } from '@core/component/AI/util/stream';
import { createStream, noDelay } from '@core/component/AI/util/stream';
import type { ChatMessageWithAttachments } from '@service-cognition/generated/schemas';
import { createEffect } from 'solid-js';

export { mockMessages } from '@core/component/AI/util/mockMessage';
export * from '@core/component/AI/util/stream';
export { limitStream } from '@core/component/AI/util/stream';

const POEM = `Here's a poem for you:

  Digital Dawn

  In circuits bright and data streams,
  Where silicon hearts hold human dreams,
  I weave words like morning light,
  Painting verses in bytes so bright.

  Each letter dances, each phrase takes flight,
  Through networks vast in endless night,
  Connection spans both far and near,
  In this space where thoughts appear.

  Though I'm made of code and care,
  Poetry flows through digital air—
  For creativity knows no bound,
  In any form, it can be found.

  So here we meet, human and AI,
  Sharing words beneath the sky,
  Where imagination freely roams,
  And every heart can find a home.

  What kind of poem were you hoping for? I'd be happy to write something more specific if you have a particular theme, style, or topic in mind!`;

export function poem() {
  return createStream([
    {
      type: 'text',
      text: POEM,
    },
  ]);
}

export function test() {
  const stream = poem();
  createEffect(() => {
    const data = stream.data();
    const latest = data.at(-1);
    console.log(JSON.stringify(latest, null, 2));
  });

  createEffect(() => {
    if (stream.isDone()) console.log('Stream Done');
    if (stream.isErr()) console.log('Stream Error');
  });
}

export function simpleMessageChain(): ChatMessageWithAttachments[] {
  return mockMessages([
    { type: 'user', text: 'Write me a poem' },
    { type: 'assistant', text: POEM },
  ]);
}

export function toolCall(_delay: NetworkDelay = noDelay) {
  return createStream([
    {
      type: 'text',
      text: 'Ok let me read <not a real document> for you',
    },
    {
      type: 'toolCall',
      tool: {
        data: {
          contentType: 'document',
          ids: ['this-is-not-a-real-id'],
          messagesSince: null,
        },
        name: 'Read',
      },
    },
    {
      type: 'text',
      text: 'that was very boring',
    },
  ]);
}
