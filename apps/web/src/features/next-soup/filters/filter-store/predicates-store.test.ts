import { setFlagsFromString } from 'node:v8';
import { runInNewContext } from 'node:vm';
import { createComponent, createContext, createRoot } from 'solid-js';
import { expect, it } from 'vitest';
import { createPredicatesStore } from './predicates-store';

setFlagsFromString('--expose-gc');
const collectGarbage: () => void = runInNewContext('gc');

async function settleAndCollect() {
  for (let pass = 0; pass < 3; pass += 1) {
    await new Promise((resolve) => setTimeout(resolve, 0));
    collectGarbage();
  }
}

type Item = { n: number };
const CONFIGS = [
  { id: 'even', predicate: (item: Item) => item.n % 2 === 0 },
  { id: 'big', predicate: (item: Item) => item.n > 10 },
] as const;

// Stands for what a view's owner holds: its context, and through it its DOM.
const ViewContext = createContext<object>();

function createInView(view: object) {
  return createRoot((dispose) => {
    let store!: ReturnType<
      typeof createPredicatesStore<Item, unknown, (typeof CONFIGS)[number]>
    >;
    createComponent(ViewContext.Provider, {
      value: view,
      get children() {
        store = createPredicatesStore({ configs: CONFIGS });
        return undefined;
      },
    });
    return { store, dispose };
  });
}

it('snapshots the active predicates', () => {
  const { store, dispose } = createInView({});
  store.set({ and: ['even'] });
  const test = store.snapshotTest();
  store.set({ and: ['big'] });

  expect(test({ n: 4 }, undefined)).toBe(true);
  expect(test({ n: 11 }, undefined)).toBe(false);
  expect(store.test({ n: 11 }, undefined)).toBe(true);
  dispose();
});

it('keeps nothing of the view that made it alive', async () => {
  let view: object | undefined = {};
  const viewRef = new WeakRef(view);
  const test = (() => {
    const { store, dispose } = createInView(view);
    store.set({ and: ['even'] });
    const snapshot = store.snapshotTest();
    dispose();
    return snapshot;
  })();
  view = undefined;
  await settleAndCollect();

  expect(test({ n: 2 }, undefined)).toBe(true);
  expect(viewRef.deref()).toBeUndefined();
});
