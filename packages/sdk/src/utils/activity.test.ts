import { describe, expect, test } from 'bun:test';
import {
  observeSdk,
  type RequestActivity,
  type RequestCall,
  setDefaultRequestObserver,
} from './activity';

describe('SDK activity', () => {
  test('correlates concurrent requests and preserves results and errors', async () => {
    const events: RequestActivity[] = [];
    let release!: () => void;
    const pending = new Promise<void>((resolve) => {
      release = resolve;
    });
    const sdk = observeSdk(
      {
        async first() {
          await pending;
          return { data: 1 };
        },
        async second() {
          return { error: 'denied' };
        },
        async third() {
          throw new Error('offline');
        },
      },
      'storage',
      (event) => {
        events.push(event);
      },
    );
    const first = sdk.first();
    expect(await sdk.second()).toEqual({ error: 'denied' });
    await expect(sdk.third()).rejects.toThrow('offline');
    release();
    expect(await first).toEqual({ data: 1 });
    expect(events.map((event) => [event.operation, event.status])).toEqual([
      ['first', 'started'],
      ['second', 'started'],
      ['second', 'failed'],
      ['third', 'started'],
      ['third', 'failed'],
      ['first', 'completed'],
    ]);
    expect(events[0].id).toBe(events[5].id);
    expect(new Set(events.map((event) => event.id)).size).toBe(3);
    expect(Object.keys(events[0]).sort()).toEqual([
      'id',
      'operation',
      'service',
      'status',
    ]);
  });
  test('async observer failures never change operation outcomes', async () => {
    const sdk = observeSdk(
      {
        async call() {
          return 42;
        },
      },
      'storage',
      async () => {
        throw new Error('observer');
      },
    );
    expect(await sdk.call()).toBe(42);
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
  test('only the runtime observer sees what a call was given and returned', async () => {
    const runtime: [string, RequestCall][] = [];
    const client: RequestActivity[] = [];
    setDefaultRequestObserver((event, call) => {
      runtime.push([event.status, call]);
    });
    try {
      const sdk = observeSdk(
        {
          async create(options: { body: { name: string } }) {
            return { data: { id: 'doc-1', name: options.body.name } };
          },
        },
        'storage',
        (event) => {
          client.push(event);
        },
      );
      await sdk.create({ body: { name: 'Plan' } });
    } finally {
      setDefaultRequestObserver(() => {});
    }
    expect(runtime).toEqual([
      ['started', { args: [{ body: { name: 'Plan' } }] }],
      [
        'completed',
        {
          args: [{ body: { name: 'Plan' } }],
          result: { data: { id: 'doc-1', name: 'Plan' } },
        },
      ],
    ]);
    expect(client.map((event) => Object.keys(event).sort())).toEqual([
      ['id', 'operation', 'service', 'status'],
      ['id', 'operation', 'service', 'status'],
    ]);
  });
  test('observer failures never change operation outcomes', async () => {
    const sdk = observeSdk(
      {
        async call() {
          return 42;
        },
      },
      'storage',
      () => {
        throw new Error('observer');
      },
    );
    expect(await sdk.call()).toBe(42);
  });
});
