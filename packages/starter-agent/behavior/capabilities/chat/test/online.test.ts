import { expect, test } from 'bun:test';
import { reportsOnline } from '../online.ts';

const settled = () => new Promise((resolve) => setTimeout(resolve, 20));

test('reports once per run, however often presence reopens', async () => {
  const statuses: number[] = [];
  const online = reportsOnline({
    post: async () => {
      statuses.push(204);
      return 204;
    },
    log: () => {},
  });

  online.report();
  online.report();
  await settled();
  online.report();
  await settled();

  expect(statuses).toEqual([204]);
});

test('retries a failed report until the server takes it', async () => {
  const answers = [503, 0, 204];
  const sent: number[] = [];
  const log: object[] = [];
  const online = reportsOnline({
    post: async () => {
      const status = answers.shift() ?? 204;
      sent.push(status);
      if (status === 0) throw new Error('connection reset');
      return status;
    },
    log: (entry) => log.push(entry),
    wait: 1,
  });

  online.report();
  await settled();

  expect(sent).toEqual([503, 0, 204]);
  expect(log.at(-1)).toEqual({ online: 'reported', status: 204 });
});

test('keeps retrying a 404, for an auth service that has no route yet', async () => {
  // The agent's code can ship before the auth service that answers it.
  const answers = [404, 404, 204];
  const sent: number[] = [];
  const online = reportsOnline({
    post: async () => {
      const status = answers.shift() ?? 204;
      sent.push(status);
      return status;
    },
    log: () => {},
    wait: 1,
  });

  online.report();
  await settled();

  expect(sent).toEqual([404, 404, 204]);
});
