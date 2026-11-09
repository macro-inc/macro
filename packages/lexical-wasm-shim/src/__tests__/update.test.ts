import { expect, test } from 'vitest';
import type { CommitPacket } from '../backend';
import { ConformanceBackend, diagnostics } from '../backend/conformance';
import { UpdateController } from '../update';

test('empty update tags do not leak into later work while pending work survives a no-op', async () => {
  const backend = new ConformanceBackend({
    namespace: 'no-op tags',
    nodes: [],
  });
  const packets: CommitPacket[] = [];
  const controller = new UpdateController({
    backend,
    scope: (body) => body(),
    apply: (packet) => packets.push(packet),
    onError: (error) => {
      throw error;
    },
  });
  try {
    controller.update(() => {}, { tag: 'empty' });
    controller.update(
      () => {
        const p = backend.call('lexical.$createParagraphNode', []);
        backend.call(
          'LexicalNode.append',
          [p],
          backend.call('lexical.$getRoot', [])
        );
      },
      { tag: 'real' }
    );
    controller.update(() => {}, { tag: 'joined' });
    expect(packets).toHaveLength(0);
    await Promise.resolve();
    expect(packets).toHaveLength(1);
    expect(JSON.parse(packets[0].metadata_json).tags).toEqual([
      'real',
      'joined',
    ]);
  } finally {
    controller.dispose();
  }
});

test('two updates and nested work publish once before listeners and deferred callbacks', async () => {
  const backend = new ConformanceBackend({ namespace: 'batch', nodes: [] });
  const events: string[] = [];
  const packets: CommitPacket[] = [];
  const controller = new UpdateController({
    backend,
    scope: (body) => body(),
    apply: (packet) => {
      packets.push(packet);
      events.push('apply');
    },
    onError: (error) => {
      throw error;
    },
  });
  controller.addUpdateListener(() => events.push('listener-one'));
  controller.addUpdateListener(() => events.push('listener-two'));
  let text: unknown;
  try {
    controller.update(
      () => {
        events.push('outer-body');
        text = backend.call('lexical.$createTextNode', ['initial']);
        const p = backend.call('lexical.$createParagraphNode', []);
        backend.call('LexicalNode.append', [text], p);
        backend.call(
          'LexicalNode.append',
          [p],
          backend.call('lexical.$getRoot', [])
        );
        controller.update(
          () => {
            events.push('nested-body');
            backend.call('LexicalNode.setTextContent', ['nested'], text);
          },
          { tag: 'nested', onUpdate: () => events.push('nested-deferred') }
        );
        events.push('after-nested');
      },
      { tag: 'outer', onUpdate: () => events.push('outer-deferred') }
    );
    controller.update(
      () => {
        events.push('second-body');
        backend.call('LexicalNode.setTextContent', ['second'], text);
      },
      { tag: ['two', 'outer'], onUpdate: () => events.push('two-deferred') }
    );
    expect(packets).toHaveLength(0);
    expect(events).toEqual([
      'outer-body',
      'after-nested',
      'nested-body',
      'second-body',
    ]);
    await Promise.resolve();
    expect(packets).toHaveLength(1);
    expect(JSON.parse(packets[0].metadata_json)).toMatchObject({
      tags: ['outer', 'nested', 'two'],
      records: expect.arrayContaining([
        expect.objectContaining({ __text: 'second' }),
      ]),
    });
    expect(events).toEqual([
      'outer-body',
      'after-nested',
      'nested-body',
      'second-body',
      'apply',
      'listener-one',
      'listener-two',
      'outer-deferred',
      'nested-deferred',
      'two-deferred',
    ]);
  } finally {
    controller.dispose();
  }
});

test('composition changes and discrete updates publish synchronously and cancel older microtasks', async () => {
  const backend = new ConformanceBackend({ namespace: 'sync', nodes: [] });
  const packets: CommitPacket[] = [];
  const controller = new UpdateController({
    backend,
    scope: (body) => body(),
    apply: (packet) => packets.push(packet),
    onError: (error) => {
      throw error;
    },
  });
  let text: unknown;
  let key = '';
  try {
    controller.update(() => {
      text = backend.call('lexical.$createTextNode', ['initial']);
      if (
        typeof text !== 'object' ||
        text === null ||
        !('key' in text) ||
        typeof text.key !== 'string'
      )
        throw new Error('missing text key');
      key = text.key;
      const p = backend.call('lexical.$createParagraphNode', []);
      backend.call('LexicalNode.append', [text], p);
      backend.call(
        'LexicalNode.append',
        [p],
        backend.call('lexical.$getRoot', [])
      );
    });
    controller.update(() => {
      backend.call('lexical.$setCompositionKey', [key]);
    });
    expect(packets).toHaveLength(1);
    await Promise.resolve();
    expect(packets).toHaveLength(1);
    controller.update(() => {
      backend.call('LexicalNode.setTextContent', ['typed'], text);
    });
    expect(packets).toHaveLength(1);
    await Promise.resolve();
    expect(packets).toHaveLength(2);
    controller.update(
      () => {
        backend.call('LexicalNode.setTextContent', ['discrete'], text);
      },
      { discrete: true }
    );
    expect(packets).toHaveLength(3);
    await Promise.resolve();
    expect(packets).toHaveLength(3);
  } finally {
    controller.dispose();
  }
});

test('an error rolls back the tick and recovery queued by onError starts a fresh update', async () => {
  const backend = new ConformanceBackend({ namespace: 'rollback', nodes: [] });
  const packets: CommitPacket[] = [];
  const errors: unknown[] = [];
  let deferred = 0;
  const thrown = { failure: true };
  const controller: UpdateController = new UpdateController({
    backend,
    scope: (body) => body(),
    apply: (packet) => packets.push(packet),
    onError: (error) => {
      errors.push(error);
      controller.update(
        () => {
          const p = backend.call('lexical.$createParagraphNode', []);
          const t = backend.call('lexical.$createTextNode', ['recovered']);
          backend.call('LexicalNode.append', [t], p);
          backend.call(
            'LexicalNode.append',
            [p],
            backend.call('lexical.$getRoot', [])
          );
        },
        { tag: 'recovery' }
      );
    },
  });
  try {
    controller.update(
      () => {
        const p = backend.call('lexical.$createParagraphNode', []);
        backend.call(
          'LexicalNode.append',
          [p],
          backend.call('lexical.$getRoot', [])
        );
        throw thrown;
      },
      {
        tag: 'discarded',
        onUpdate: () => {
          deferred++;
        },
      }
    );
    expect(errors).toEqual([thrown]);
    expect(packets).toHaveLength(0);
    await Promise.resolve();
    expect(packets).toHaveLength(1);
    expect(deferred).toBe(0);
    expect(JSON.parse(packets[0].metadata_json)).toMatchObject({
      tags: ['recovery'],
      records: expect.arrayContaining([
        expect.objectContaining({ __text: 'recovered' }),
      ]),
    });
  } finally {
    controller.dispose();
  }
});

test('listener updates run after all listeners and deferred callbacks, with their own commit', async () => {
  const backend = new ConformanceBackend({
    namespace: 'listener phases',
    nodes: [],
  });
  const events: string[] = [];
  let text: unknown;
  let once = false;
  const controller = new UpdateController({
    backend,
    scope: (body) => body(),
    apply: () => events.push('apply'),
    onError: (error) => {
      throw error;
    },
  });
  controller.addUpdateListener(() => {
    events.push('listener-one');
    if (!once) {
      once = true;
      controller.update(
        () => {
          events.push('queued-body');
          backend.call('LexicalNode.setTextContent', ['queued'], text);
        },
        { onUpdate: () => events.push('queued-deferred') }
      );
    }
  });
  controller.addUpdateListener(() => events.push('listener-two'));
  try {
    controller.update(
      () => {
        text = backend.call('lexical.$createTextNode', ['initial']);
        const p = backend.call('lexical.$createParagraphNode', []);
        backend.call('LexicalNode.append', [text], p);
        backend.call(
          'LexicalNode.append',
          [p],
          backend.call('lexical.$getRoot', [])
        );
      },
      { discrete: true, onUpdate: () => events.push('first-deferred') }
    );
    expect(events).toEqual([
      'apply',
      'listener-one',
      'listener-two',
      'first-deferred',
      'queued-body',
    ]);
    await Promise.resolve();
    expect(events).toEqual([
      'apply',
      'listener-one',
      'listener-two',
      'first-deferred',
      'queued-body',
      'apply',
      'listener-one',
      'listener-two',
      'queued-deferred',
    ]);
  } finally {
    controller.dispose();
  }
});

test('disposal inside an update cancels queued bodies and frees after the current scope', async () => {
  const backend = new ConformanceBackend({ namespace: 'dispose', nodes: [] });
  let queued = 0;
  let applied = 0;
  const controller = new UpdateController({
    backend,
    scope: (body) => body(),
    apply: () => {
      applied++;
    },
    onError: (error) => {
      throw error;
    },
  });
  controller.update(() => {
    backend.call('lexical.$createParagraphNode', []);
    controller.update(() => {
      queued++;
    });
    controller.dispose();
  });
  expect(diagnostics.liveEditors()).toBe(0);
  expect(() => controller.update(() => {})).toThrow('editor is disposed');
  await Promise.resolve();
  expect(queued).toBe(0);
  expect(applied).toBe(0);
  controller.dispose();
});

test('one thousand listener-enqueued no-op rounds reset the cascade guard', async () => {
  const backend = new ConformanceBackend({
    namespace: 'no-op cascade',
    nodes: [],
  });
  const errors: unknown[] = [];
  let listeners = 0;
  let text: unknown;
  const controller = new UpdateController({
    backend,
    scope: (body) => body(),
    apply: () => {},
    onError: (error) => errors.push(error),
  });
  try {
    controller.update(
      () => {
        text = backend.call('lexical.$createTextNode', ['initial']);
        const p = backend.call('lexical.$createParagraphNode', []);
        backend.call('LexicalNode.append', [text], p);
        backend.call(
          'LexicalNode.append',
          [p],
          backend.call('lexical.$getRoot', [])
        );
      },
      { discrete: true }
    );
    controller.addUpdateListener(() => {
      listeners++;
      controller.update(() => {});
    });
    for (let index = 0; index < 1000; index++) {
      controller.update(() => {
        backend.call('LexicalNode.setTextContent', [`value${index}`], text);
      });
      await Promise.resolve();
      await Promise.resolve();
    }
    expect(errors).toEqual([]);
    expect(listeners).toBe(1000);
  } finally {
    controller.dispose();
  }
});
