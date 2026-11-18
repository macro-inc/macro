import { setFlagsFromString } from 'node:v8';
import { runInNewContext } from 'node:vm';
import { MutationObserver, QueryClient } from '@tanstack/solid-query';
import {
  createComponent,
  createComputed,
  createContext,
  createRoot,
  createSignal,
} from 'solid-js';
import { expect, it } from 'vitest';
import { useIsMutating, useMutationState } from './mutation-state';

setFlagsFromString('--expose-gc');
const collectGarbage: () => void = runInNewContext('gc');

async function settleAndCollect() {
  for (let pass = 0; pass < 3; pass += 1) {
    await new Promise((resolve) => setTimeout(resolve, 0));
    collectGarbage();
  }
}

// Stands for what a view's owner holds: its context, and through it its DOM.
const ViewContext = createContext<object>();

it.each([
  ['useMutationState', useMutationState],
  ['useIsMutating', useIsMutating],
] as const)(
  '%s lets an unmounted view go while another computation keeps running',
  async (_, hook) => {
    const client = new QueryClient();
    // A mutation outside the view, whose options computation stays alive.
    const [key, setKey] = createSignal('first');
    const observer = new MutationObserver(client, { mutationKey: ['first'] });
    const disposeApp = createRoot((dispose) => {
      createComputed(() => observer.setOptions({ mutationKey: [key()] }));
      return dispose;
    });

    let view: object | undefined = {};
    const viewRef = new WeakRef(view);
    const disposeView = createRoot((dispose) => {
      createComponent(ViewContext.Provider, {
        value: view,
        get children() {
          hook(undefined, () => client);
          return undefined;
        },
      });
      return dispose;
    });
    view = undefined;
    await settleAndCollect();

    // The cache notifies the view's listener inside the mutation's computation.
    setKey('second');
    disposeView();
    await settleAndCollect();

    expect(viewRef.deref()).toBeUndefined();
    disposeApp();
  }
);
