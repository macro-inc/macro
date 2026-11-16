import { setFlagsFromString } from 'node:v8';
import { runInNewContext } from 'node:vm';
import { QueryClient, QueryObserver } from '@tanstack/query-core';
import { expect, it } from 'vitest';

setFlagsFromString('--expose-gc');
const collectGarbage: () => void = runInNewContext('gc');

// WeakRef targets stay alive until the job that read them ends.
async function settleAndCollect() {
  for (let pass = 0; pass < 3; pass += 1) {
    await new Promise((resolve) => setTimeout(resolve, 0));
    collectGarbage();
  }
}

it('lets go of the data a query held when the observer attached', async () => {
  const client = new QueryClient();
  const queryKey = ['list'];
  let attachedWith: { id: string }[] | undefined = [{ id: 'first' }];
  const attachedData = new WeakRef(attachedWith);
  client.setQueryData(queryKey, attachedWith);
  const observer = new QueryObserver(client, {
    queryKey,
    queryFn: () => [],
    enabled: false,
  });
  const unsubscribe = observer.subscribe(() => {});
  expect(observer.getCurrentResult().isFetchedAfterMount).toBe(false);

  client.setQueryData(queryKey, [{ id: 'second' }]);
  attachedWith = undefined;
  await settleAndCollect();

  expect(observer.getCurrentResult().data).toEqual([{ id: 'second' }]);
  expect(observer.getCurrentResult().isFetchedAfterMount).toBe(true);
  expect(attachedData.deref()).toBeUndefined();
  unsubscribe();
});
