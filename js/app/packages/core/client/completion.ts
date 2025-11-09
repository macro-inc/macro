import { cognitionWebsocketServiceClient } from '@service-cognition/client';
import { createCognitionWebsocketBlockEffect } from '@service-cognition/websocket';
import { createEffect, createRoot } from 'solid-js';
import { createStore } from 'solid-js/store';
import { v4 as uuid } from 'uuid';

export type Completion = {
  content: string;
  status: 'loading' | 'streaming' | 'completed';
};

type CompletionStore = Record<string, Completion>;

const [completionStore, setCompletionStore] = createStore<CompletionStore>({});

createCognitionWebsocketBlockEffect('completion_response', (data) => {
  setCompletionStore(data.completion_id, {
    content: data.content,
    status: data.done ? 'completed' : 'streaming',
  });
});

/** Streams a completion from the dcs websocket
 *
 * @param data - The data to send to the websocket
 * @param setter - A callback to set the completion to a signal
 * (this is required because the websocket message are async)
 *
 * @example
 * ```tsx
 * const [completion, setCompletion] = createSignal<Completion | undefined>(undefined);
 * streamCompletion(
 *   {
 *     prompt: 'Hello world',
 *     attachmentId: 'my-attachment-id',
 *   },
 *   setCompletion
 * );
 *
 * return <div>{completion()?.content}</div>
 * ```
 */
export function streamCompletion(
  data: { prompt: string; attachmentId?: string; selectedText?: string },
  setter: (completion: Completion) => void
) {
  const completionId = uuid();
  setCompletionStore(completionId, {
    content: '',
    status: 'loading',
  });

  cognitionWebsocketServiceClient.sendCompletion({
    prompt:
      data.prompt +
      // TODO: @synoet - rework prompt later so that this is not needed
      ' ... (PLEASE RENDER ANY MATHEMATICAL EQUATIONS OR LATEX e.g. left \right or \frac{}{} or anything like that AND ANY EXPRESSIONS USING LATEX SYNTAX ENCLOSED IN DOUBLE DOLLAR SIGNS ($$ ... $$))',
    attachment_id: data.attachmentId,
    completion_id: completionId,
    selected_text: data.selectedText,
  });

  createRoot((dispose) => {
    createEffect(() => {
      const completion = completionStore[completionId];
      if (!completion) return;
      setter(completion);
      if (completion.status === 'completed') {
        dispose();
      }
    });
  });
}
